# Optuna worker skeleton

`worker.py` translates a bounded JSON search space into an Optuna study. Each
trial invokes an executable with an argument array and `shell=False`, then reads
one numeric metric from a JSON file.

The sampler is seeded and uses Optuna TPE's seeded random startup phase before
TPE suggestions. Missing, boolean, NaN, and infinite metric values fail the
trial and are never returned as objective values.

The worker does not accept shell command strings or inline secrets. Put the
worker, its spec, and the objective program in the Git revision materialized at
`/workspace`. The runner container policy supplies CPU, memory, PID, network,
and wall-clock limits.

The included `spec.example.json` is illustrative: a project must provide the
referenced `train.py` before running it.
