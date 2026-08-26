import { describe, expect, it } from 'vitest';
import {
  answerModelQuestion,
  classifyGradient,
  gradientAt,
  gradientStateAt,
  moduleGradientHealth,
  parameterCoverageAt,
  runAgentReview,
  shapesEqual,
} from './model-lab-domain';
import {
  bottleneckAutoencoder,
  filmTransformerClassifier,
  residualClassifier,
  residualGradientEvidence,
  sampleModels,
  sparkvskLearnedWarmPath,
  tropicLambdaPathCompiler,
  transformerFilmGradientEvidence,
} from './sample-models';

describe('Model Lab domain', () => {
  it('checks tensor contracts without confusing symbolic dimensions', () => {
    expect(shapesEqual(['B', 256], ['B', 256])).toBe(true);
    expect(shapesEqual(['B', 256], ['B', 128])).toBe(false);
    expect(shapesEqual(['B', 'T', 64], ['B', 64, 'T'])).toBe(false);
  });

  it('classifies observed gradient signals and never calls a broken path healthy', () => {
    expect(classifyGradient(0.02)).toBe('healthy');
    expect(classifyGradient(1e-12)).toBe('low');
    expect(classifyGradient(0)).toBe('blocked');
    expect(classifyGradient(100)).toBe('exploding');
    expect(classifyGradient(Number.NaN)).toBe('invalid');
    expect(classifyGradient(0.02, true, 'detached')).toBe('blocked');
    expect(classifyGradient(0.02, true, 'not-observed')).toBe('invalid');
    expect(classifyGradient(Number.NaN, false, 'frozen')).toBe('not-applicable');
    expect(classifyGradient(Number.NaN, false, 'not-applicable')).toBe('not-applicable');
    expect(classifyGradient(Number.NaN, true, 'frozen')).toBe('invalid');
  });

  it('does not label discrete token ids as carrying a healthy gradient', () => {
    expect(moduleGradientHealth(filmTransformerClassifier, 'tf-token-input', 'healthy', 4)).toBe(
      'not-applicable',
    );
    expect(moduleGradientHealth(filmTransformerClassifier, 'tf-token-input', 'vanishing', 4)).toBe(
      'not-applicable',
    );
    expect(moduleGradientHealth(filmTransformerClassifier, 'tf-token-input', 'exploding', 4)).toBe(
      'not-applicable',
    );
  });

  it('passes the healthy demo through independent shape, intent, gradient, and code checks', () => {
    const reviews = runAgentReview(residualClassifier, 'healthy', 4);
    expect(reviews.map((review) => review.id)).toEqual([
      'shape-auditor',
      'intent-referee',
      'autograd-inspector',
      'code-mapper',
    ]);
    expect(reviews.every((review) => review.status === 'pass')).toBe(true);
  });

  it('does not call a textual code anchor verified when its source artifact is absent', () => {
    const reviews = runAgentReview(bottleneckAutoencoder, 'healthy', 4);
    const codeReview = reviews.find((review) => review.id === 'code-mapper');
    const gradientReview = reviews.find((review) => review.id === 'autograd-inspector');
    expect(codeReview?.status).toBe('warning');
    expect(codeReview?.summary).toContain('do not resolve to a verified source artifact');
    expect(gradientReview?.status).toBe('warning');
    expect(
      gradientReview?.evidence.some((finding) =>
        finding.includes('no observed runtime gradient receipt'),
      ),
    ).toBe(true);
  });

  it('warns instead of vacuously passing when a model has no gradient connections or evidence', () => {
    const zeroConnectionModel = {
      ...bottleneckAutoencoder,
      id: 'zero-connection-model',
      connections: [],
      gradientEvidence: null,
    };
    const reviews = runAgentReview(zeroConnectionModel, 'healthy', 0);
    const gradientReview = reviews.find((review) => review.id === 'autograd-inspector');

    expect(gradientReview?.status).toBe('warning');
    expect(gradientReview?.summary).toContain('not observed');
    expect(
      gradientReview?.evidence.some((finding) =>
        finding.includes('no expected gradient-carrying graph connections'),
      ),
    ).toBe(true);
    expect(
      gradientReview?.evidence.some((finding) =>
        finding.includes('no trainable parameter-gradient coverage receipt'),
      ),
    ).toBe(true);
    expect(moduleGradientHealth(zeroConnectionModel, 'ae-input', 'healthy', 0)).toBe('invalid');
  });

  it('blocks verification when a required residual path is detached', () => {
    const reviews = runAgentReview(residualClassifier, 'detached', 4);
    const gradientReview = reviews.find((review) => review.id === 'autograd-inspector');
    expect(gradientReview?.status).toBe('error');
    expect(gradientReview?.evidence.some((finding) => finding.includes('blocked'))).toBe(true);
    expect(gradientReview?.evidence.some((finding) => finding.includes('detached'))).toBe(true);
    expect(gradientReview?.evidence).toContain(
      'Trainable parameter coverage: 4/10 tensors and 35594/299018 elements observed.',
    );
  });

  it('imports five real PyTorch probes for both the attached and residual.detach variants', () => {
    expect(residualGradientEvidence.probeCount).toBe(5);
    expect(residualGradientEvidence.scenarios.healthy.variant).toBe(
      'fully attached autograd graph',
    );
    expect(residualGradientEvidence.scenarios.detached.variant).toBe('residual.detach()');

    const healthyParameters = Object.values(residualGradientEvidence.scenarios.healthy.parameters);
    const detachedParameters = residualGradientEvidence.scenarios.detached.parameters;
    expect(healthyParameters).toHaveLength(10);
    expect(
      healthyParameters.every(
        (parameter) =>
          parameter.trainable &&
          parameter.states.length === 5 &&
          parameter.states.every((state) => state === 'observed'),
      ),
    ).toBe(true);

    for (const name of [
      'pre_norm.weight',
      'pre_norm.bias',
      'residual_mlp.0.weight',
      'residual_mlp.0.bias',
      'residual_mlp.2.weight',
      'residual_mlp.2.bias',
    ]) {
      expect(detachedParameters[name]?.states).toEqual(Array(5).fill('detached'));
      expect(detachedParameters[name]?.gradientRms).toEqual(Array(5).fill(null));
    }

    for (const coverage of residualGradientEvidence.scenarios.healthy.parameterCoverage) {
      expect(coverage.denominator).toEqual({ elements: 299_018, tensors: 10 });
      expect(coverage.observed).toEqual(coverage.denominator);
    }
    for (const coverage of residualGradientEvidence.scenarios.detached.parameterCoverage) {
      expect(coverage.denominator).toEqual({ elements: 299_018, tensors: 10 });
      expect(coverage.observed).toEqual({ elements: 35_594, tensors: 4 });
      expect(coverage.detached).toEqual({ elements: 263_424, tensors: 6 });
    }
  });

  it('makes the statically reconstructed TROPIC compiler the default sample', () => {
    expect(sampleModels[0]).toBe(tropicLambdaPathCompiler);
    expect(tropicLambdaPathCompiler.modules).toHaveLength(13);
    expect(tropicLambdaPathCompiler.connections).toHaveLength(12);
    expect(tropicLambdaPathCompiler.intent.invariants).toContain(
      'Viterbi decoding couples adjacent λ layers; the final audit jointly ranks objective, continuity, and feasibility.',
    );
    expect(
      tropicLambdaPathCompiler.connections.every(
        (connection) =>
          !connection.expectedToCarryGradient &&
          connection.gradient.states.healthy.every((state) => state === 'not-applicable'),
      ),
    ).toBe(true);
    expect(tropicLambdaPathCompiler.gradientEvidence).toBeNull();
    expect(
      tropicLambdaPathCompiler.modules.find((module) => module.id === 'tropic-lattice'),
    ).toMatchObject({
      inputShape: ['Q', 'S', 'K'],
      outputShape: ['Q', 'L', 'K'],
      codeReference: 'TROPIC_PORTABLE_20260822/tropic.py:257-321',
    });
    expect(
      tropicLambdaPathCompiler.modules.find((module) => module.id === 'tropic-viterbi')?.formula,
    ).toContain(String.raw`\min_i`);
    expect(
      tropicLambdaPathCompiler.modules.find((module) => module.id === 'tropic-output')?.outputShape,
    ).toEqual(['Q', 'p']);

    const reviews = runAgentReview(tropicLambdaPathCompiler, 'healthy', 4);
    expect(reviews.find((review) => review.id === 'shape-auditor')?.status).toBe('pass');
    expect(reviews.find((review) => review.id === 'intent-referee')?.status).toBe('pass');
    expect(reviews.find((review) => review.id === 'code-mapper')?.status).toBe('pass');
    expect(reviews.find((review) => review.id === 'autograd-inspector')?.status).toBe('warning');
    expect(reviews.find((review) => review.id === 'autograd-inspector')?.evidence).toContain(
      'not-observed: no observed runtime gradient receipt backs this scenario.',
    );
  });

  it('expands the SPARKVSK warm path into a shape-consistent λ-conditioned model', () => {
    expect(sampleModels[1]).toBe(sparkvskLearnedWarmPath);
    expect(sparkvskLearnedWarmPath.modules).toHaveLength(13);
    expect(sparkvskLearnedWarmPath.connections).toHaveLength(12);
    expect(sparkvskLearnedWarmPath.intent.expectedInput).toEqual(['B', 'n', 'p']);
    expect(sparkvskLearnedWarmPath.intent.expectedOutput).toEqual(['B', 'Q', 'p']);

    const lambdaQuery = sparkvskLearnedWarmPath.modules.find(
      (module) => module.id === 'sparkvsk-lambda-query',
    );
    expect(lambdaQuery).toMatchObject({
      name: 'Penalty + λ query encoder',
      inputShape: ['B', 'p', 'd'],
      outputShape: ['B', 'Q', 'q_dim'],
      codeReference: 'TROPIC_PORTABLE_20260822/model_spark_vs.py:29-37, 167-176',
    });
    expect(lambdaQuery?.formula).toContain(String.raw`\lambda_q=r_q\lambda_{\max}`);
    expect(lambdaQuery?.explanation).toContain('exact answer to where λ enters');
    expect(
      tropicLambdaPathCompiler.modules.find((module) => module.id === 'tropic-spark-warm-path')
        ?.subgraph,
    ).toEqual({ modelId: sparkvskLearnedWarmPath.id });
    expect(
      sparkvskLearnedWarmPath.connections.every((connection) =>
        connection.gradient.states.healthy.every((state) => state === 'not-observed'),
      ),
    ).toBe(true);

    const reviews = runAgentReview(sparkvskLearnedWarmPath, 'healthy', 4);
    expect(reviews.find((review) => review.id === 'shape-auditor')?.status).toBe('pass');
    expect(reviews.find((review) => review.id === 'intent-referee')?.status).toBe('pass');
    expect(reviews.find((review) => review.id === 'code-mapper')?.status).toBe('pass');
    expect(reviews.find((review) => review.id === 'autograd-inspector')?.status).toBe('warning');
  });

  it('keeps the FiLM Transformer sample explicit and shape-aligned', () => {
    expect(filmTransformerClassifier.intent.invariants).toContain(
      'The attention width satisfies H × Dₕ = 4 × 16 = D = 64.',
    );

    const attention = filmTransformerClassifier.modules.find(
      (module) => module.id === 'tf-attention',
    );
    const gamma = filmTransformerClassifier.modules.find((module) => module.id === 'tf-gamma');
    const beta = filmTransformerClassifier.modules.find((module) => module.id === 'tf-beta');
    const film = filmTransformerClassifier.modules.find((module) => module.id === 'tf-film');
    const attentionDimensions = /D=(\d+), H=(\d+), Dₕ=(\d+)/.exec(attention?.transform ?? '');
    expect(attentionDimensions).not.toBeNull();
    const modelWidth = Number(attentionDimensions?.[1]);
    const headCount = Number(attentionDimensions?.[2]);
    const headWidth = Number(attentionDimensions?.[3]);
    expect(headCount * headWidth).toBe(modelWidth);
    expect(attention?.outputShape.at(-1)).toBe(modelWidth);
    expect(gamma?.outputShape).toEqual(['B', 'T', 64]);
    expect(beta?.outputShape).toEqual(['B', 'T', 64]);
    expect(film?.formula).toBe(String.raw`y=(1+\gamma)\odot x+\beta`);
    expect(
      filmTransformerClassifier.modules.reduce((total, module) => total + module.parameterCount, 0),
    ).toBe(46_694);

    const reviews = runAgentReview(filmTransformerClassifier, 'healthy', 4);
    expect(reviews.every((review) => review.status === 'pass')).toBe(true);
    expect(reviews.find((review) => review.id === 'shape-auditor')?.summary).toContain(
      '17 tensor interfaces',
    );
  });

  it('uses five actual probes to expose a blocked FiLM condition path without blocking main flow', () => {
    expect(transformerFilmGradientEvidence.probeCount).toBe(5);
    expect(transformerFilmGradientEvidence.scenarios.healthy.variant).toBe(
      'fully attached FiLM conditioning graph',
    );
    expect(transformerFilmGradientEvidence.scenarios.detached.variant).toBe(
      'gamma.detach(); beta.detach()',
    );

    const healthyParameters = Object.values(
      transformerFilmGradientEvidence.scenarios.healthy.parameters,
    );
    expect(healthyParameters).toHaveLength(19);
    expect(
      healthyParameters.every((parameter) =>
        parameter.states.every((state) => state === 'observed'),
      ),
    ).toBe(true);

    const detachedParameters = transformerFilmGradientEvidence.scenarios.detached.parameters;
    for (const name of [
      'condition_encoder.0.weight',
      'condition_encoder.0.bias',
      'gamma_projection.weight',
      'gamma_projection.bias',
      'beta_projection.weight',
      'beta_projection.bias',
    ]) {
      expect(detachedParameters[name]?.states).toEqual(Array(5).fill('detached'));
      expect(detachedParameters[name]?.gradientRms).toEqual(Array(5).fill(null));
    }
    expect(detachedParameters['attention.in_proj_weight']?.states).toEqual(
      Array(5).fill('observed'),
    );
    expect(detachedParameters['ffn.0.weight']?.states).toEqual(Array(5).fill('observed'));

    for (const coverage of transformerFilmGradientEvidence.scenarios.healthy.parameterCoverage) {
      expect(coverage.denominator).toEqual({ elements: 46_694, tensors: 19 });
      expect(coverage.observed).toEqual(coverage.denominator);
    }
    for (const coverage of transformerFilmGradientEvidence.scenarios.detached.parameterCoverage) {
      expect(coverage.observed).toEqual({ elements: 41_926, tensors: 13 });
      expect(coverage.detached).toEqual({ elements: 4_768, tensors: 6 });
    }

    expect(
      transformerFilmGradientEvidence.scenarios.detached.edges['tf-e-gamma-film']?.states,
    ).toEqual(Array(5).fill('detached'));
    expect(
      transformerFilmGradientEvidence.scenarios.detached.edges['tf-e-ffn-film']?.states,
    ).toEqual(Array(5).fill('observed'));
    expect(
      transformerFilmGradientEvidence.scenarios.healthy.edges['tf-e-token-embedding']?.states,
    ).toEqual(Array(5).fill('not-applicable'));

    const detachedReviews = runAgentReview(filmTransformerClassifier, 'detached', 4);
    const gradientReview = detachedReviews.find((review) => review.id === 'autograd-inspector');
    expect(gradientReview?.status).toBe('error');
    expect(gradientReview?.evidence).toContain(
      'Trainable parameter coverage: 13/19 tensors and 41926/46694 elements observed.',
    );
    expect(moduleGradientHealth(filmTransformerClassifier, 'tf-film', 'detached', 4)).toBe(
      'blocked',
    );
    expect(moduleGradientHealth(filmTransformerClassifier, 'tf-ffn', 'detached', 4)).toBe(
      'healthy',
    );
  });

  it('uses the selected checkpoint instead of summing or reusing another gradient snapshot', () => {
    const connection = residualClassifier.connections[0];
    expect(connection).toBeDefined();
    if (!connection) return;
    const generatedValues =
      residualGradientEvidence.scenarios.healthy.edges['e-input-projection']?.gradientRms;
    expect(generatedValues).toBeDefined();
    expect(gradientAt(connection, 'healthy', 0)).toBe(generatedValues?.[0]);
    expect(gradientAt(connection, 'healthy', 4)).toBe(generatedValues?.[4]);
    expect(gradientAt(connection, 'healthy', 999)).toBe(generatedValues?.[4]);
    expect(gradientStateAt(connection, 'healthy', 999)).toBe('observed');
  });

  it('keeps synthetic stress traces distinct from observed PyTorch evidence', () => {
    const connection = residualClassifier.connections[0];
    const designConnection = bottleneckAutoencoder.connections[0];
    expect(connection?.gradient.scenarioKinds).toMatchObject({
      healthy: 'pytorch-observed',
      detached: 'pytorch-observed',
      vanishing: 'synthetic-stress',
      exploding: 'synthetic-stress',
    });
    expect(designConnection?.gradient.scenarioKinds.healthy).toBe('design-only');
    expect(gradientStateAt(designConnection!, 'healthy', 0)).toBe('not-observed');
    expect(parameterCoverageAt(residualClassifier, 'vanishing', 0)).toBeNull();
  });

  it('grounds chat answers in the selected module and active gradient scenario', () => {
    const answer = answerModelQuestion(
      'gradient가 이 module까지 와?',
      residualClassifier,
      'merge',
      'detached',
      4,
    );
    expect(answer).toContain('blocked');
    expect(answer).toContain('gradient detached');
  });
});
