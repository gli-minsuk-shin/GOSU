#!/usr/bin/env python3
"""Generate deterministic PyTorch gradient evidence for Model Lab samples.

The artifact contains two real five-probe executions of the same residual model:

* ``healthy`` keeps the residual branch attached.
* ``detached`` applies ``residual.detach()`` immediately before the residual add.

Every graph edge and every parameter tensor is classified independently. Missing
gradients in the detached branch are therefore evidence from autograd, rather than
numbers synthesized by the TypeScript demo. ``--model transformer-film`` emits a
second fixture whose conditioning path can be blocked with ``gamma.detach()`` and
``beta.detach()`` while the main Transformer path remains connected.
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Iterable
from dataclasses import dataclass

import torch
from torch import Tensor, nn

SEED = 20_260_821
PROBE_COUNT = 5


@dataclass(frozen=True)
class Scenario:
    name: str
    label: str
    detach_residual: bool

    @property
    def variant(self) -> str:
        return (
            "residual.detach()"
            if self.detach_residual
            else "fully attached autograd graph"
        )


SCENARIOS = (
    Scenario(
        name="healthy",
        label="Observed PyTorch backward trace",
        detach_residual=False,
    ),
    Scenario(
        name="detached",
        label="Observed PyTorch trace with a detached residual branch",
        detach_residual=True,
    ),
)


@dataclass(frozen=True)
class FilmScenario:
    name: str
    label: str
    detach_condition: bool

    @property
    def variant(self) -> str:
        return (
            "gamma.detach(); beta.detach()"
            if self.detach_condition
            else "fully attached FiLM conditioning graph"
        )


FILM_SCENARIOS = (
    FilmScenario(
        name="healthy",
        label="Observed PyTorch Transformer + FiLM backward trace",
        detach_condition=False,
    ),
    FilmScenario(
        name="detached",
        label="Observed PyTorch trace with detached FiLM condition parameters",
        detach_condition=True,
    ),
)


class ResidualClassifier(nn.Module):
    def __init__(self, *, detach_residual: bool) -> None:
        super().__init__()
        self.detach_residual = detach_residual
        self.projection = nn.Sequential(nn.Linear(128, 256), nn.GELU())
        self.pre_norm = nn.LayerNorm(256)
        self.residual_mlp = nn.Sequential(
            nn.Linear(256, 512), nn.GELU(), nn.Linear(512, 256)
        )
        self.head = nn.Linear(256, 10)
        self.edge_tensors: dict[str, Tensor] = {}

    def forward(self, inputs: Tensor) -> Tensor:
        projected = self.projection(inputs)

        # Separate zero-cost autograd nodes let us measure the two outgoing edges
        # from ``projected`` independently instead of observing only their sum.
        residual_input = projected + 0
        skip_input = projected + 0
        normalized = self.pre_norm(residual_input)
        residual_output = self.residual_mlp(normalized)
        residual_to_merge = (
            residual_output.detach() if self.detach_residual else residual_output
        )
        merged = skip_input + residual_to_merge
        logits = self.head(merged)

        self.edge_tensors = {
            "e-input-projection": inputs,
            "e-projection-norm": residual_input,
            "e-norm-residual": normalized,
            "e-projection-skip": skip_input,
            "e-residual-merge": residual_to_merge,
            "e-skip-merge": skip_input,
            "e-merge-head": merged,
        }
        for tensor in self.edge_tensors.values():
            if tensor.requires_grad:
                tensor.retain_grad()
        return logits


class FilmTransformerClassifier(nn.Module):
    """A small pre-norm Transformer block with explicit FiLM conditioning."""

    def __init__(self, *, detach_condition: bool) -> None:
        super().__init__()
        self.detach_condition = detach_condition
        self.token_embedding = nn.Embedding(128, 64)
        self.attention = nn.MultiheadAttention(
            embed_dim=64, num_heads=4, batch_first=True
        )
        self.pre_norm = nn.LayerNorm(64)
        self.ffn = nn.Sequential(nn.Linear(64, 128), nn.GELU(), nn.Linear(128, 64))
        self.condition_encoder = nn.Sequential(nn.Linear(16, 32), nn.SiLU())
        self.gamma_projection = nn.Linear(32, 64)
        self.beta_projection = nn.Linear(32, 64)
        self.head = nn.Linear(64, 6)
        self.edge_tensors: dict[str, Tensor] = {}

    def forward(self, token_ids: Tensor, condition: Tensor) -> Tensor:
        tokens = self.token_embedding(token_ids)
        attention_input = tokens + 0
        attention_skip = tokens + 0
        attention_output, _ = self.attention(
            attention_input, attention_input, attention_input, need_weights=False
        )
        attention_added = attention_output + attention_skip

        ffn_input = attention_added + 0
        output_skip = attention_added + 0
        normalized = self.pre_norm(ffn_input)
        ffn_output = self.ffn(normalized)

        condition_encoded = self.condition_encoder(condition)
        gamma_input = condition_encoded + 0
        beta_input = condition_encoded + 0
        gamma = self.gamma_projection(gamma_input).unsqueeze(1)
        beta = self.beta_projection(beta_input).unsqueeze(1)
        gamma = gamma.expand(-1, token_ids.shape[1], -1)
        beta = beta.expand(-1, token_ids.shape[1], -1)
        gamma_to_film = gamma.detach() if self.detach_condition else gamma
        beta_to_film = beta.detach() if self.detach_condition else beta

        film_output = (1 + gamma_to_film) * ffn_output + beta_to_film
        output = output_skip + film_output
        logits = self.head(output.mean(dim=1))

        self.edge_tensors = {
            "tf-e-token-embedding": token_ids,
            "tf-e-embedding-attention": attention_input,
            "tf-e-embedding-attn-skip": attention_skip,
            "tf-e-attention-add": attention_output,
            "tf-e-attn-skip-add": attention_skip,
            "tf-e-attn-add-norm": ffn_input,
            "tf-e-attn-add-output-skip": output_skip,
            "tf-e-norm-ffn": normalized,
            "tf-e-ffn-film": ffn_output,
            "tf-e-condition-encoder": condition,
            "tf-e-encoder-gamma": gamma_input,
            "tf-e-encoder-beta": beta_input,
            "tf-e-gamma-film": gamma_to_film,
            "tf-e-beta-film": beta_to_film,
            "tf-e-film-output-add": film_output,
            "tf-e-output-skip-add": output_skip,
            "tf-e-output-add-head": output,
        }
        for tensor in self.edge_tensors.values():
            if tensor.requires_grad:
                tensor.retain_grad()
        return logits


def tensor_shape(tensor: Tensor) -> list[int]:
    return list(tensor.shape)


def tensor_rms(tensor: Tensor) -> float:
    return float(torch.sqrt(torch.mean(tensor.detach().float().square())).item())


def state_for_gradient(
    gradient: Tensor | None,
    *,
    expected: bool,
    known_detached: bool = False,
    trainable: bool | None = None,
) -> str:
    if trainable is False:
        return "frozen"
    if not expected:
        return "not-applicable"
    if gradient is None:
        return "detached" if known_detached else "not-observed"
    if not bool(torch.isfinite(gradient).all().item()):
        return "nonfinite"
    return "observed"


def gradient_rms_or_none(gradient: Tensor | None) -> float | None:
    if gradient is None or not bool(torch.isfinite(gradient).all().item()):
        return None
    return tensor_rms(gradient)


def count_by_state(
    observations: Iterable[dict[str, object]], state: str, key: str
) -> int:
    return sum(int(item[key]) for item in observations if item["state"] == state)


def parameter_coverage(parameters: list[dict[str, object]]) -> dict[str, object]:
    included = [
        parameter
        for parameter in parameters
        if parameter["state"] not in {"frozen", "not-applicable"}
    ]
    return {
        "denominator": {
            "tensors": len(included),
            "elements": sum(int(parameter["elementCount"]) for parameter in included),
        },
        "observed": {
            "tensors": count_by_state(included, "observed", "tensorCount"),
            "elements": count_by_state(included, "observed", "elementCount"),
        },
        "detached": {
            "tensors": count_by_state(included, "detached", "tensorCount"),
            "elements": count_by_state(included, "detached", "elementCount"),
        },
        "nonfinite": {
            "tensors": count_by_state(included, "nonfinite", "tensorCount"),
            "elements": count_by_state(included, "nonfinite", "elementCount"),
        },
        "notObserved": {
            "tensors": count_by_state(included, "not-observed", "tensorCount"),
            "elements": count_by_state(included, "not-observed", "elementCount"),
        },
        "excluded": {
            "frozenTensors": count_by_state(parameters, "frozen", "tensorCount"),
            "frozenElements": count_by_state(parameters, "frozen", "elementCount"),
            "notApplicableTensors": count_by_state(
                parameters, "not-applicable", "tensorCount"
            ),
            "notApplicableElements": count_by_state(
                parameters, "not-applicable", "elementCount"
            ),
        },
    }


def aggregate_scenario(
    *, label: str, variant: str, probes: list[dict[str, object]]
) -> dict[str, object]:
    first_probe = probes[0]
    first_edges = first_probe["edges"]
    first_parameters = first_probe["parameters"]
    assert isinstance(first_edges, dict)
    assert isinstance(first_parameters, list)

    edge_traces: dict[str, dict[str, object]] = {}
    for edge_id, first_edge in first_edges.items():
        assert isinstance(first_edge, dict)
        observations = []
        for probe in probes:
            edges = probe["edges"]
            assert isinstance(edges, dict)
            edge = edges[edge_id]
            assert isinstance(edge, dict)
            observations.append(edge)
        edge_traces[edge_id] = {
            "shape": first_edge["shape"],
            "activationRms": [edge["activationRms"] for edge in observations],
            "gradientRms": [edge["gradientRms"] for edge in observations],
            "states": [edge["state"] for edge in observations],
        }

    parameter_traces: dict[str, dict[str, object]] = {}
    for first_parameter in first_parameters:
        assert isinstance(first_parameter, dict)
        name = str(first_parameter["name"])
        observations = []
        for probe in probes:
            parameters = probe["parameters"]
            assert isinstance(parameters, list)
            observation = next(
                parameter
                for parameter in parameters
                if isinstance(parameter, dict) and parameter["name"] == name
            )
            observations.append(observation)
        parameter_traces[name] = {
            "shape": first_parameter["shape"],
            "elementCount": first_parameter["elementCount"],
            "trainable": first_parameter["trainable"],
            "gradientRms": [parameter["gradientRms"] for parameter in observations],
            "states": [parameter["state"] for parameter in observations],
        }

    return {
        "kind": "pytorch-observed",
        "label": label,
        "variant": variant,
        "losses": [probe["loss"] for probe in probes],
        "edges": edge_traces,
        "parameters": parameter_traces,
        "parameterCoverage": [probe["parameterCoverage"] for probe in probes],
    }


def detached_edge(edge_id: str, scenario: Scenario) -> bool:
    return scenario.detach_residual and edge_id in {
        "e-projection-norm",
        "e-norm-residual",
        "e-residual-merge",
    }


def detached_parameter(parameter_name: str, scenario: Scenario) -> bool:
    return scenario.detach_residual and parameter_name.startswith(
        ("pre_norm.", "residual_mlp.")
    )


def run_scenario(
    scenario: Scenario, initial_state: dict[str, Tensor]
) -> dict[str, object]:
    model = ResidualClassifier(detach_residual=scenario.detach_residual)
    model.load_state_dict(initial_state)
    model.train()
    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4)
    generator = torch.Generator().manual_seed(SEED + 101)
    probes: list[dict[str, object]] = []

    for probe_index in range(PROBE_COUNT):
        optimizer.zero_grad(set_to_none=True)
        inputs = torch.randn(8, 128, generator=generator, requires_grad=True)
        labels = torch.tensor([(index + probe_index) % 10 for index in range(8)])
        logits = model(inputs)
        loss = nn.functional.cross_entropy(logits, labels)
        loss.backward()

        edges: dict[str, dict[str, object]] = {}
        for edge_id, tensor in model.edge_tensors.items():
            gradient = tensor.grad if tensor.requires_grad else None
            state = state_for_gradient(
                gradient,
                expected=True,
                known_detached=detached_edge(edge_id, scenario),
            )
            edges[edge_id] = {
                "shape": tensor_shape(tensor),
                "activationRms": tensor_rms(tensor),
                "gradientRms": gradient_rms_or_none(gradient),
                "state": state,
            }

        parameters: list[dict[str, object]] = []
        for name, parameter in model.named_parameters():
            state = state_for_gradient(
                parameter.grad,
                expected=parameter.requires_grad,
                known_detached=detached_parameter(name, scenario),
                trainable=parameter.requires_grad,
            )
            parameters.append(
                {
                    "name": name,
                    "shape": tensor_shape(parameter),
                    "tensorCount": 1,
                    "elementCount": parameter.numel(),
                    "trainable": parameter.requires_grad,
                    "gradientRms": gradient_rms_or_none(parameter.grad),
                    "state": state,
                }
            )

        probes.append(
            {
                "probe": probe_index + 1,
                "loss": float(loss.item()),
                "edges": edges,
                "parameters": parameters,
                "parameterCoverage": parameter_coverage(parameters),
            }
        )
        optimizer.step()

    return aggregate_scenario(
        label=scenario.label, variant=scenario.variant, probes=probes
    )


def detached_film_edge(edge_id: str, scenario: FilmScenario) -> bool:
    return scenario.detach_condition and edge_id in {
        "tf-e-condition-encoder",
        "tf-e-encoder-gamma",
        "tf-e-encoder-beta",
        "tf-e-gamma-film",
        "tf-e-beta-film",
    }


def detached_film_parameter(parameter_name: str, scenario: FilmScenario) -> bool:
    return scenario.detach_condition and parameter_name.startswith(
        ("condition_encoder.", "gamma_projection.", "beta_projection.")
    )


def film_edge_expects_gradient(edge_id: str) -> bool:
    return edge_id != "tf-e-token-embedding"


def run_film_scenario(
    scenario: FilmScenario, initial_state: dict[str, Tensor]
) -> dict[str, object]:
    model = FilmTransformerClassifier(detach_condition=scenario.detach_condition)
    model.load_state_dict(initial_state)
    model.train()
    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4)
    generator = torch.Generator().manual_seed(SEED + 202)
    probes: list[dict[str, object]] = []

    for probe_index in range(PROBE_COUNT):
        optimizer.zero_grad(set_to_none=True)
        token_ids = torch.randint(0, 128, (4, 12), generator=generator)
        condition = torch.randn(4, 16, generator=generator, requires_grad=True)
        labels = torch.tensor([(index + probe_index) % 6 for index in range(4)])
        logits = model(token_ids, condition)
        loss = nn.functional.cross_entropy(logits, labels)
        loss.backward()

        edges: dict[str, dict[str, object]] = {}
        for edge_id, tensor in model.edge_tensors.items():
            expected = film_edge_expects_gradient(edge_id)
            gradient = tensor.grad if tensor.requires_grad else None
            state = state_for_gradient(
                gradient,
                expected=expected,
                known_detached=detached_film_edge(edge_id, scenario),
            )
            edges[edge_id] = {
                "shape": tensor_shape(tensor),
                "activationRms": tensor_rms(tensor),
                "gradientRms": gradient_rms_or_none(gradient),
                "state": state,
            }

        parameters: list[dict[str, object]] = []
        for name, parameter in model.named_parameters():
            state = state_for_gradient(
                parameter.grad,
                expected=parameter.requires_grad,
                known_detached=detached_film_parameter(name, scenario),
                trainable=parameter.requires_grad,
            )
            parameters.append(
                {
                    "name": name,
                    "shape": tensor_shape(parameter),
                    "tensorCount": 1,
                    "elementCount": parameter.numel(),
                    "trainable": parameter.requires_grad,
                    "gradientRms": gradient_rms_or_none(parameter.grad),
                    "state": state,
                }
            )

        probes.append(
            {
                "probe": probe_index + 1,
                "loss": float(loss.item()),
                "edges": edges,
                "parameters": parameters,
                "parameterCoverage": parameter_coverage(parameters),
            }
        )
        optimizer.step()

    return aggregate_scenario(
        label=scenario.label, variant=scenario.variant, probes=probes
    )


def generate_residual_evidence() -> dict[str, object]:
    torch.manual_seed(SEED)
    initial_model = ResidualClassifier(detach_residual=False)
    initial_state = {
        name: tensor.detach().clone()
        for name, tensor in initial_model.state_dict().items()
    }
    return {
        "schemaVersion": 1,
        "generator": "tools/generate_residual_trace.py --model residual",
        "framework": "PyTorch",
        "torchVersion": torch.__version__,
        "seed": SEED,
        "mode": "train",
        "loss": {"name": "cross_entropy"},
        "probeCount": PROBE_COUNT,
        "scenarios": {
            scenario.name: run_scenario(scenario, initial_state)
            for scenario in SCENARIOS
        },
    }


def generate_film_evidence() -> dict[str, object]:
    torch.manual_seed(SEED + 1)
    initial_model = FilmTransformerClassifier(detach_condition=False)
    initial_state = {
        name: tensor.detach().clone()
        for name, tensor in initial_model.state_dict().items()
    }
    return {
        "schemaVersion": 1,
        "generator": "tools/generate_residual_trace.py --model transformer-film",
        "framework": "PyTorch",
        "torchVersion": torch.__version__,
        "seed": SEED + 1,
        "mode": "train",
        "loss": {"name": "cross_entropy"},
        "probeCount": PROBE_COUNT,
        "scenarios": {
            scenario.name: run_film_scenario(scenario, initial_state)
            for scenario in FILM_SCENARIOS
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model",
        choices=("residual", "transformer-film"),
        default="residual",
    )
    args = parser.parse_args()
    evidence = (
        generate_film_evidence()
        if args.model == "transformer-film"
        else generate_residual_evidence()
    )
    print(json.dumps(evidence, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
