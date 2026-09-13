#!/usr/bin/env python3
"""Build a bounded architecture index from Python source without importing it."""

from __future__ import annotations

import ast
import argparse
import json
import re
import sys
import textwrap


MAX_FOCUSED_SOURCE_CHARACTERS = 50_000
MAX_ALLOWED_SOURCE_CHARACTERS = 1024 * 1024
MAX_DOCUMENTATION_CHARACTERS = 8_000


def assigned_names(node: ast.AST) -> list[str]:
    targets: list[ast.AST] = []
    if isinstance(node, ast.Assign):
        targets.extend(node.targets)
    elif isinstance(node, ast.AnnAssign):
        targets.append(node.target)
    names: list[str] = []
    for target in targets:
        if isinstance(target, ast.Name):
            names.append(target.id)
        elif isinstance(target, (ast.Tuple, ast.List)):
            names.extend(item.id for item in target.elts if isinstance(item, ast.Name))
    return names


def node_references(node: ast.AST) -> set[str]:
    return {
        child.id
        for child in ast.walk(node)
        if isinstance(child, ast.Name) and isinstance(child.ctx, ast.Load)
    }


def class_methods(node: ast.ClassDef) -> list[str]:
    return [
        child.name
        for child in node.body
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]


def documented_calls(documentation: str, symbols: set[str]) -> tuple[list[str], set[str]]:
    """Parse usage examples as evidence, never as executable code or instructions."""
    snippets: list[str] = []
    block: list[str] = []
    for line in documentation.splitlines() + [""]:
        if line.startswith((" ", "\t")) and line.strip():
            block.append(line)
        elif block:
            snippets.append(textwrap.dedent("\n".join(block)))
            block = []
    calls: list[str] = []
    references: set[str] = set()
    aliases: dict[str, str] = {}
    for snippet in snippets:
        try:
            example = ast.parse(snippet)
        except SyntaxError:
            continue
        for node in ast.walk(example):
            if isinstance(node, ast.ImportFrom):
                aliases.update((alias.asname or alias.name, alias.name) for alias in node.names)
        for node in ast.walk(example):
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
                name = aliases.get(node.id, node.id)
                if name in symbols:
                    references.add(name)
            if isinstance(node, ast.Call):
                target = node.func
                if isinstance(target, ast.Name):
                    name = aliases.get(target.id, target.id)
                elif isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name):
                    name = aliases.get(target.value.id, target.value.id)
                else:
                    continue
                if name in symbols and name not in calls:
                    calls.append(name)
    return calls, references


def symbol_closure(roots: list[str], records: dict[str, dict[str, object]]) -> tuple[set[str], dict[str, int]]:
    closure: set[str] = set()
    depths = {name: 0 for name in roots}
    pending = list(roots)
    while pending:
        name = pending.pop(0)
        if name in closure or name not in records:
            continue
        closure.add(name)
        depth = depths[name]
        for reference in records[name]["references"]:
            if reference in records and reference not in closure:
                depths[reference] = min(depths.get(reference, depth + 1), depth + 1)
                pending.append(reference)
    return closure, depths


def callable_parameter_methods(node: ast.AST) -> set[str]:
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        return set()
    parameters = {arg.arg for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs}
    return {
        call.func.attr
        for call in ast.walk(node)
        if isinstance(call, ast.Call)
        and isinstance(call.func, ast.Attribute)
        and isinstance(call.func.value, ast.Name)
        and call.func.value.id in parameters
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-source-characters", type=int, default=MAX_FOCUSED_SOURCE_CHARACTERS)
    arguments = parser.parse_args()
    source_budget = arguments.max_source_characters
    if not 1 <= source_budget <= MAX_ALLOWED_SOURCE_CHARACTERS:
        parser.error("max-source-characters must be an integer between 1 and 1048576")
    source = sys.stdin.read()
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": f"line {error.lineno}: {error.msg}",
                }
            )
        )
        return

    lines = source.splitlines(keepends=True)
    records: dict[str, dict[str, object]] = {}
    exports: list[str] = []
    module_docstring = ast.get_docstring(tree, clean=False) or ""

    for node in tree.body:
        names: list[str] = []
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names = [node.name]
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            names = assigned_names(node)
        if "__all__" in names and isinstance(node, ast.Assign):
            try:
                value = ast.literal_eval(node.value)
                if isinstance(value, (list, tuple)) and all(isinstance(item, str) for item in value):
                    exports = list(value)
            except (TypeError, ValueError):
                pass
        for name in names:
            decorators = getattr(node, "decorator_list", [])
            records[name] = {
                "name": name,
                "kind": type(node).__name__,
                "line": min([node.lineno] + [decorator.lineno for decorator in decorators]),
                "endLine": node.end_lineno or node.lineno,
                "references": sorted(node_references(node)),
                "node": node,
            }

    class_records = [
        record
        for record in records.values()
        if isinstance(record["node"], ast.ClassDef)
    ]
    direct_model_names: set[str] = set()
    class_bases: dict[str, list[str]] = {}
    class_method_names: dict[str, list[str]] = {}
    for record in class_records:
        node = record["node"]
        assert isinstance(node, ast.ClassDef)
        bases = [ast.unparse(base) for base in node.bases]
        methods = class_methods(node)
        class_bases[node.name] = bases
        class_method_names[node.name] = methods
        if any("Module" in base for base in bases) or node.name.endswith(("Net", "Model")):
            direct_model_names.add(node.name)

    model_names = set(direct_model_names)
    changed = True
    while changed:
        changed = False
        for name, bases in class_bases.items():
            if name not in model_names and any(base.split(".")[-1] in model_names for base in bases):
                model_names.add(name)
                changed = True

    solver_names = {
        name
        for name, methods in class_method_names.items()
        if name.endswith("Solver") or bool({"solve", "solve_path", "from_checkpoint"} & set(methods))
    }
    documented_owners = re.findall(
        r"\b([A-Z][A-Za-z0-9_]*)\.(?:from_checkpoint|solve_path|solve)\b",
        module_docstring,
    )

    example_calls, example_references = documented_calls(module_docstring, set(records))
    known_model_methods = {
        method for name in model_names for method in class_method_names[name]
    } - {"__init__"}
    local_closures = {
        name: symbol_closure([name], records)[0]
        for name in set(example_calls + exports) if name in records
    }

    def model_call_score(name: str) -> int:
        node = records[name]["node"]
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            return 0
        direct = False
        for dependency in local_closures.get(name, {name}):
            function = records[dependency]["node"]
            if not isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            parameters = {arg.arg for arg in function.args.posonlyargs + function.args.args + function.args.kwonlyargs}
            direct = direct or any(
                isinstance(call, ast.Call)
                and isinstance(call.func, ast.Name)
                and call.func.id in parameters
                for call in ast.walk(function)
            )
        methods = callable_parameter_methods(node) & known_model_methods
        # A top-level function can orchestrate a supplied network through helper calls.
        helper_methods = set().union(*(
            callable_parameter_methods(records[dependency]["node"])
            for dependency in local_closures.get(name, {name})
        )) & known_model_methods
        return int(direct) + len(methods | helper_methods)

    candidates = list(dict.fromkeys(
        name for name in example_calls if name in solver_names
    ))
    if not example_calls:
        candidates = list(dict.fromkeys(name for name in documented_owners if name in solver_names))
    selection_reason = "Documented public solver usage resolves to this local class."
    if not candidates:
        scores = {name: model_call_score(name) for name in example_calls}
        maximum = max(scores.values(), default=0)
        candidates = [name for name, score in scores.items() if score == maximum and score > 0]
        # Eliminate documented helper calls when another candidate contains them.
        candidates = [
            name for name in candidates
            if not any(name in local_closures[other] for other in candidates if other != name)
        ]
        selection_reason = "Documented function call orchestrates a supplied model through statically visible calls."
    if not candidates:
        candidates = [name for name in example_calls if name in model_names]
        selection_reason = "Documented usage instantiates this model."
    if not candidates:
        candidates = [name for name in exports if name in solver_names]
        selection_reason = "Exported public solver candidate."
    if not candidates:
        candidates = [name for name in exports if name in records and model_call_score(name) > 0]
        candidates = [
            name for name in candidates
            if not any(name in local_closures[other] for other in candidates if other != name)
        ]
        selection_reason = "Exported function orchestrates a supplied model through statically visible calls."
    if not candidates:
        candidates = [name for name in exports if name in model_names]
        selection_reason = "Exported model candidate; export order does not imply preference."
    if not candidates:
        model_dependencies = set().union(*(
            symbol_closure([name], records)[0] - {name} for name in model_names
        )) if model_names else set()
        candidates = sorted(model_names - model_dependencies)
        selection_reason = "Model root not referenced by another model class."
    if not candidates:
        candidates = [name for name in example_calls if isinstance(records[name]["node"], (ast.FunctionDef, ast.AsyncFunctionDef))]
        selection_reason = "Documented local function candidate."
    if not candidates:
        candidates = [name for name in ("solve_path", "forward", "main") if name in records]
        selection_reason = "Conventional public function candidate."
    candidates = list(dict.fromkeys(candidates))
    selection_status = "selected" if len(candidates) == 1 else "ambiguous"
    primary_symbol = candidates[0] if len(candidates) == 1 else "<ambiguous>"
    if selection_status == "ambiguous":
        selection_reason = "Static source does not establish a unique deployment entrypoint; preserve alternatives separately."

    methods = class_method_names.get(primary_symbol, [])
    if "solve_path" in methods:
        primary_entrypoint = f"{primary_symbol}.solve_path"
    elif "forward" in methods:
        primary_entrypoint = f"{primary_symbol}.forward"
    else:
        primary_entrypoint = primary_symbol

    # The example may instantiate the supplied network through a loader. Its local
    # source and branches are evidence, not proof of a specific checkpoint branch.
    roots = candidates + sorted(example_references)
    closure, depths = symbol_closure(roots, records)
    primary_closure, primary_depths = symbol_closure(candidates, records)
    dependency_candidates = [records[name] for name in closure]
    effective_methods = {name: set(methods) for name, methods in class_method_names.items()}
    for _ in class_records:
        for name, bases in class_bases.items():
            for base in bases:
                effective_methods[name].update(effective_methods.get(base.split(".")[-1], set()))
    required_model_methods = set().union(*(
        callable_parameter_methods(records[name]["node"]) for name in candidates
    )) & known_model_methods
    interface_model_names = {
        name for name in model_names & closure
        if required_model_methods and required_model_methods <= effective_methods[name]
    }

    def priority(record: dict[str, object]) -> tuple[int, int, int, str]:
        name = str(record["name"])
        if name == primary_symbol:
            group = 0
        elif isinstance(record["node"], (ast.Assign, ast.AnnAssign)):
            group = 1
        elif name in interface_model_names:
            group = 2
        elif name in example_references:
            group = 3
        elif name in primary_closure and primary_depths.get(name, 999) <= 1:
            group = 4
        elif name in model_names or name in solver_names:
            group = 5
        else:
            group = 6
        return group, depths.get(name, 999), int(record["line"]), name

    selected: list[dict[str, object]] = []
    selected_spans: set[tuple[int, int]] = set()
    bounded_docstring = module_docstring[:min(MAX_DOCUMENTATION_CHARACTERS, max(0, source_budget // 4 - 8))]
    focused_parts = []
    if bounded_docstring:
        focused_parts.append(f'"""{bounded_docstring}"""')
    selected_characters = sum(len(part) + 2 for part in focused_parts)
    omitted_import_statements = []
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            statement = ast.get_source_segment(source, node) or ast.unparse(node)
            if selected_characters + len(statement) + 2 <= source_budget:
                focused_parts.append(statement)
                selected_characters += len(statement) + 2
            else:
                omitted_import_statements.append(ast.unparse(node))
    for record in sorted(dependency_candidates, key=priority):
        span = (int(record["line"]), int(record["endLine"]))
        if span in selected_spans:
            continue
        segment = "".join(lines[span[0] - 1 : span[1]])
        marker = f"# --- original lines {span[0]}-{span[1]}: {record['name']} ---\n"
        if selected_characters + len(segment) + len(marker) + 2 > source_budget:
            continue
        selected.append(record)
        selected_spans.add(span)
        selected_characters += len(segment) + len(marker) + 2

    selected.sort(key=lambda record: (int(record["line"]), int(record["endLine"])))
    selected_names = {
        name for name in closure
        if (int(records[name]["line"]), int(records[name]["endLine"])) in selected_spans
    }
    for record in selected:
        start = int(record["line"])
        end = int(record["endLine"])
        focused_parts.append(
            f"# --- original lines {start}-{end}: {record['name']} ---\n"
            + "".join(lines[start - 1 : end]).rstrip()
        )

    def class_descriptor(name: str) -> dict[str, object]:
        record = records[name]
        return {
            "name": name,
            "line": record["line"],
            "bases": class_bases.get(name, []),
            "methods": class_method_names.get(name, []),
            "inPrimaryClosure": name in closure,
        }

    print(
        json.dumps(
            {
                "ok": True,
                "primarySymbol": primary_symbol,
                "primaryEntrypoint": primary_entrypoint,
                "entrypointCandidates": candidates,
                "selectionStatus": selection_status,
                "selectionReason": selection_reason,
                "documentedCalls": example_calls,
                "modelInterfaceCandidates": sorted(interface_model_names),
                "documentedOwners": documented_owners,
                "exports": exports,
                "modelClasses": [
                    class_descriptor(name)
                    for name in sorted(model_names, key=lambda item: int(records[item]["line"]))
                ],
                "solverClasses": [
                    class_descriptor(name)
                    for name in sorted(solver_names, key=lambda item: int(records[item]["line"]))
                ],
                "dependencySymbols": sorted(closure, key=lambda name: (int(records[name]["line"]), name)),
                "omittedDependencySymbols": sorted(closure - selected_names),
                "excludedModelClasses": sorted(model_names - closure),
                "totalLines": len(lines),
                "totalCharacters": len(source),
                "selectedLines": sum(
                    int(record["endLine"]) - int(record["line"]) + 1 for record in selected
                ),
                "selectedCharacters": len("\n\n".join(focused_parts)),
                "sourceBudgetCharacters": source_budget,
                "documentationTruncated": len(bounded_docstring) < len(module_docstring),
                "omittedImportStatements": omitted_import_statements,
                "focusedSource": "\n\n".join(focused_parts),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
