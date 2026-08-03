#!/usr/bin/env python3
"""Small Optuna worker using structured process arguments and shell=False."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from typing import Any

import optuna


PLACEHOLDER = re.compile(r"\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}")
SHELL_NAMES = {
    "bash",
    "cmd",
    "cmd.exe",
    "dash",
    "fish",
    "powershell",
    "powershell.exe",
    "pwsh",
    "sh",
    "zsh",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a bounded Optuna study")
    parser.add_argument("--spec", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def load_spec(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        spec = json.load(handle)
    required = {"study_name", "direction", "n_trials", "search_space", "objective"}
    missing = sorted(required.difference(spec))
    if missing:
        raise ValueError(f"missing spec fields: {', '.join(missing)}")
    if spec["direction"] not in {"maximize", "minimize"}:
        raise ValueError("direction must be maximize or minimize")
    if not isinstance(spec["n_trials"], int) or spec["n_trials"] <= 0:
        raise ValueError("n_trials must be a positive integer")
    objective = spec["objective"]
    if not isinstance(objective.get("args"), list):
        raise ValueError("objective.args must be an array")
    executable = str(objective.get("executable", "")).strip()
    if not executable or Path(executable).name.lower() in SHELL_NAMES:
        raise ValueError("objective.executable must be a non-shell executable")
    return spec


def suggest(trial: optuna.Trial, name: str, definition: dict[str, Any]) -> Any:
    kind = definition.get("type")
    if kind == "float":
        return trial.suggest_float(
            name,
            float(definition["low"]),
            float(definition["high"]),
            log=bool(definition.get("log", False)),
            step=definition.get("step"),
        )
    if kind == "int":
        return trial.suggest_int(
            name,
            int(definition["low"]),
            int(definition["high"]),
            step=int(definition.get("step", 1)),
            log=bool(definition.get("log", False)),
        )
    if kind == "categorical":
        choices = definition.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ValueError(f"search_space.{name}.choices must be a non-empty array")
        return trial.suggest_categorical(name, choices)
    raise ValueError(f"unsupported search-space type for {name}: {kind}")


def render(value: str, variables: dict[str, Any]) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in variables:
            raise ValueError(f"unknown objective placeholder: {key}")
        return str(variables[key])

    return PLACEHOLDER.sub(replace, value)


def safe_path(base: Path, relative: str) -> Path:
    candidate = (base / relative).resolve()
    try:
        candidate.relative_to(base.resolve())
    except ValueError as error:
        raise ValueError(f"path escapes working directory: {relative}") from error
    return candidate


def make_objective(spec: dict[str, Any], workspace_root: Path):
    search_space = spec["search_space"]
    objective_spec = spec["objective"]
    working_directory = safe_path(workspace_root, str(spec.get("working_directory", ".")))
    timeout = int(spec.get("trial_timeout_seconds", 3600))

    def objective(trial: optuna.Trial) -> float:
        variables = {
            name: suggest(trial, name, definition)
            for name, definition in search_space.items()
        }
        variables["trial_number"] = trial.number
        executable = render(str(objective_spec["executable"]), variables)
        arguments = [render(str(item), variables) for item in objective_spec["args"]]
        metric_relative = render(str(objective_spec["metric_file"]), variables)
        metric_path = safe_path(working_directory, metric_relative)
        metric_path.parent.mkdir(parents=True, exist_ok=True)
        completed = subprocess.run(
            [executable, *arguments],
            cwd=working_directory,
            env=os.environ.copy(),
            shell=False,
            check=False,
            timeout=timeout,
        )
        if completed.returncode != 0:
            raise RuntimeError(f"objective exited with code {completed.returncode}")
        with metric_path.open("r", encoding="utf-8") as handle:
            metrics = json.load(handle)
        key = objective_spec["metric_key"]
        if (
            key not in metrics
            or isinstance(metrics[key], bool)
            or not isinstance(metrics[key], (int, float))
        ):
            raise ValueError(f"metric file must contain numeric key: {key}")
        value = float(metrics[key])
        if not math.isfinite(value):
            raise ValueError(f"metric key must be finite: {key}")
        return value

    return objective


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def main() -> int:
    arguments = parse_args()
    workspace_root = Path.cwd().resolve()
    spec_path = safe_path(workspace_root, str(arguments.spec))
    output_path = safe_path(workspace_root, str(arguments.output))
    spec = load_spec(spec_path)
    sampler = optuna.samplers.TPESampler(seed=int(spec.get("seed", 0)))
    study = optuna.create_study(
        study_name=spec["study_name"],
        direction=spec["direction"],
        sampler=sampler,
        storage=spec.get("storage"),
        load_if_exists=bool(spec.get("storage")),
    )
    study.optimize(make_objective(spec, workspace_root), n_trials=spec["n_trials"])
    summary = {
        "study_name": study.study_name,
        "direction": spec["direction"],
        "completed_trials": len(study.trials),
        "best_trial": study.best_trial.number,
        "best_value": study.best_value,
        "best_params": study.best_params,
    }
    atomic_json(output_path, summary)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"optimizer error: {error}", file=sys.stderr)
        raise SystemExit(2) from error
