import { describe, expect, it } from 'vitest';

import {
  EXPERIMENT_EVALUATION_CODE_POLICY_HASH,
  ExperimentEvaluationCodePolicyError,
  validateExperimentEvaluationReferenceCode,
} from '../src/main/experiment-evaluation-code-policy';

describe('Experiment evaluation reference-code policy', () => {
  it('accepts deterministic metric code from the narrow scientific allowlist', () => {
    const result = validateExperimentEvaluationReferenceCode(`
import json
import math
import numpy as np
from sklearn.metrics import mean_squared_error

def evaluate(expected, predicted):
    expected_array = np.asarray(expected)
    predicted_array = np.asarray(predicted)
    rmse = math.sqrt(mean_squared_error(expected_array, predicted_array))
    return json.dumps({"rmse": rmse})
`);

    expect(result).toEqual({
      schemaVersion: 1,
      policyVersion: 1,
      policyHash: EXPERIMENT_EVALUATION_CODE_POLICY_HASH,
      executionAuthorized: false,
    });
    expect(EXPERIMENT_EVALUATION_CODE_POLICY_HASH).toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each([
    ['syntax errors', 'def evaluate(:\n    pass'],
    ['dynamic imports', 'module = __import__("subprocess")'],
    ['forbidden imports', 'from os import system\nsystem("id")'],
    ['filesystem reads', 'data = open("result.json").read()'],
    ['path access', 'import pathlib\npathlib.Path("result.json")'],
    ['file mutation helpers', 'import shutil\nshutil.rmtree("results")'],
    ['reflective access', 'value = getattr(target, "system")'],
    ['NumPy file loading', 'import numpy as np\nvalues = np.load("result.npy")'],
  ])('rejects %s', (_label, source) => {
    expect(() => validateExperimentEvaluationReferenceCode(source)).toThrow(
      ExperimentEvaluationCodePolicyError,
    );
  });
});
