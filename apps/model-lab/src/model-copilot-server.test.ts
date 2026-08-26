import { describe, expect, it } from 'vitest';
import {
  buildModelBuilderPrompt,
  buildModelCopilotPrompt,
  compactModelEvidence,
  extractDocxText,
  MODEL_BUILDER_REASONING,
  MODEL_BUILDER_TIMEOUT_MS,
  MODEL_BUILDER_MAX_PDF_PAGES,
  MODEL_IR_OUTPUT_SCHEMA,
  MODEL_LAB_CLAUDE_CODE_OPUS_ID,
  MODEL_LAB_CLAUDE_CODE_OPUS_5_ID,
  MODEL_LAB_CLAUDE_CODE_SONNET_ID,
  modelAgentSeedEvidence,
  modelBuilderCodexExecutionPlan,
  modelBuilderUserFacingError,
  pdfPageRenderArguments,
  resolveModelCopilotSelection,
  shouldAttachPdfRenders,
  standaloneModelCopilotCatalog,
} from '../model-copilot-server';
import { composeModelSubgraphs, nestedModuleId, overviewModel } from './model-graph';
import type { ModelLabQuestionRequest } from './model-lab-runtime-adapter';
import { sampleModels, sparkvskLearnedWarmPath, tropicLambdaPathCompiler } from './sample-models';

function questionRequest(): ModelLabQuestionRequest {
  return {
    projectModels: sampleModels,
    activeModelId: sparkvskLearnedWarmPath.id,
    selectedModuleId: 'sparkvsk-lambda-query',
    probe: 'healthy',
    checkpointIndex: 4,
    question: '그래서 lambda 가 input 으로 들어가나?',
    conversation: [
      { role: 'user', body: 'SPARKVSK를 이름만 말하지 말고 내부 계산을 풀어줘.' },
      { role: 'assistant', body: '다음 답변에서는 코드 근거와 tensor shape을 연결하겠습니다.' },
    ],
  };
}

function expectEveryObjectPropertyRequired(schema: unknown, path = 'root'): void {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
  const record = schema as Record<string, unknown>;
  if (record.type === 'object') {
    const properties = record.properties as Record<string, unknown> | undefined;
    expect(properties, `${path}.properties`).toBeDefined();
    expect([...(record.required as string[])].sort(), `${path}.required`).toEqual(
      Object.keys(properties ?? {}).sort(),
    );
    for (const [key, property] of Object.entries(properties ?? {})) {
      expectEveryObjectPropertyRequired(property, `${path}.properties.${key}`);
    }
  }
  if (record.items) expectEveryObjectPropertyRequired(record.items, `${path}.items`);
  if (Array.isArray(record.anyOf)) {
    record.anyOf.forEach((option, index) =>
      expectEveryObjectPropertyRequired(option, `${path}.anyOf[${index}]`),
    );
  }
}

describe('Model Copilot server prompt boundary', () => {
  it('builds a bounded active-model evidence packet with selected-module and recent chat context', () => {
    const evidence = compactModelEvidence(questionRequest());

    expect(evidence.activeModel.id).toBe(sparkvskLearnedWarmPath.id);
    expect(evidence.selectedModule.id).toBe('sparkvsk-lambda-query');
    expect(evidence.activeModel.modules).toHaveLength(13);
    expect(evidence.activeModel.connections).toHaveLength(12);
    expect(evidence.relatedProjectModels).toHaveLength(sampleModels.length);
    expect(evidence.relatedProjectModels[0]).not.toHaveProperty('modules');
    expect(evidence.recentConversation).toHaveLength(2);
    expect(evidence.question).toContain('lambda');
  });

  it('forces the LLM to explain λ transformation from bounded ModelIR rather than naming SPARKVSK', () => {
    const prompt = buildModelCopilotPrompt(questionRequest());
    const lambdaFormula = sparkvskLearnedWarmPath.modules.find(
      (module) => module.id === 'sparkvsk-lambda-query',
    )?.formula;

    expect(prompt).toContain('Explain the computation, not merely the module name.');
    expect(prompt).toContain('trace exactly where it enters');
    expect(prompt).toContain('inline LaTeX in $...$ and display equations in $$...$$');
    expect(prompt).toContain('GOSU Model Lab tool receipts');
    expect(prompt).toContain('Do not inspect any other files');
    expect(prompt).toContain('sparkvsk-lambda-query');
    expect(lambdaFormula).toBeDefined();
    expect(prompt).toContain(JSON.stringify(lambdaFormula).slice(1, -1));
    expect(prompt).toContain('model_spark_vs.py:29-37, 167-176');
    expect(prompt).toContain('그래서 lambda 가 input 으로 들어가나?');
    expect(prompt).toContain(tropicLambdaPathCompiler.name);
    const seed = modelAgentSeedEvidence(questionRequest());
    expect(seed.selectedModule.id).toBe('sparkvsk-lambda-query');
    expect(seed.activeModel).not.toHaveProperty('modules');
  });

  it('adds turn-scoped text, image names, and extracted documents without injecting binary data', () => {
    const prompt = buildModelCopilotPrompt(
      {
        ...questionRequest(),
        attachments: [
          {
            name: 'implementation.py',
            mediaType: 'text/x-python',
            kind: 'python',
            encoding: 'utf8',
            content: 'class Conditioner: pass',
          },
          {
            name: 'diagram.png',
            mediaType: 'image/png',
            kind: 'image',
            encoding: 'base64',
            content: 'binary-must-not-enter-prompt',
          },
          {
            name: 'paper.pdf',
            mediaType: 'application/pdf',
            kind: 'pdf',
            encoding: 'base64',
            content: 'pdf-binary-must-not-enter-prompt',
          },
        ],
      },
      { 'paper.pdf': 'The conditioner injects gamma and beta after normalization.' },
    );

    expect(prompt).toContain('ATTACHED PYTHON implementation.py');
    expect(prompt).toContain('class Conditioner: pass');
    expect(prompt).toContain('ATTACHED IMAGES: diagram.png');
    expect(prompt).toContain('ATTACHED PDF TEXT paper.pdf');
    expect(prompt).toContain('injects gamma and beta');
    expect(prompt).not.toContain('binary-must-not-enter-prompt');
    expect(prompt).not.toContain('pdf-binary-must-not-enter-prompt');
  });

  it('resolves the same nullable model and reasoning selection semantics as GOSU', () => {
    const catalog = standaloneModelCopilotCatalog('2026-08-25T00:00:00.000Z');

    expect(resolveModelCopilotSelection(catalog, undefined)).toMatchObject({
      descriptor: { modelId: 'gpt-5.6-sol', providerId: 'codex' },
      reasoning: 'high',
    });
    expect(
      resolveModelCopilotSelection(catalog, {
        requestedModelId: 'gpt-5.6-sol',
        reasoningOptionId: 'high',
      }),
    ).toMatchObject({ descriptor: { modelId: 'gpt-5.6-sol' }, reasoning: 'high' });
    expect(() =>
      resolveModelCopilotSelection(catalog, {
        requestedModelId: 'missing-model',
        reasoningOptionId: null,
      }),
    ).toThrow('model_copilot_selected_model_unavailable');
  });

  it('adds subscription-backed Claude Code aliases without changing the Codex default', () => {
    const catalog = standaloneModelCopilotCatalog('2026-08-26T00:00:00.000Z', {
      version: '2.1.169 (Claude Code)',
      subscriptionType: 'pro',
    });

    expect(
      catalog.models.map((model) => [model.providerId, model.modelId, model.isDefault]),
    ).toEqual([
      ['codex', 'gpt-5.6-sol', true],
      ['claude-code', MODEL_LAB_CLAUDE_CODE_SONNET_ID, false],
      ['claude-code', MODEL_LAB_CLAUDE_CODE_OPUS_ID, false],
      ['claude-code', MODEL_LAB_CLAUDE_CODE_OPUS_5_ID, false],
    ]);
    expect(
      resolveModelCopilotSelection(catalog, {
        requestedModelId: MODEL_LAB_CLAUDE_CODE_OPUS_5_ID,
        reasoningOptionId: 'xhigh',
      }),
    ).toMatchObject({
      descriptor: { providerId: 'claude-code', modelId: MODEL_LAB_CLAUDE_CODE_OPUS_5_ID },
      reasoning: 'xhigh',
    });
    expect(
      catalog.models.find((model) => model.modelId === MODEL_LAB_CLAUDE_CODE_OPUS_5_ID)?.metadata,
    ).toMatchObject({ upstreamModelId: 'claude-opus-5' });
  });

  it('grounds Copilot in an inline-expanded submodule selected inside its parent graph', () => {
    const composition = composeModelSubgraphs(
      overviewModel(tropicLambdaPathCompiler, 'overview'),
      sampleModels,
      ['tropic-spark-warm-path'],
    );
    const selectedModuleId = nestedModuleId('tropic-spark-warm-path', 'sparkvsk-lambda-query');
    const evidence = compactModelEvidence({
      ...questionRequest(),
      projectModels: sampleModels.map((model) =>
        model.id === tropicLambdaPathCompiler.id ? composition.model : model,
      ),
      activeModelId: tropicLambdaPathCompiler.id,
      selectedModuleId,
    });

    expect(evidence.activeModel.id).toBe(tropicLambdaPathCompiler.id);
    expect(evidence.selectedModule.id).toBe(selectedModuleId);
    expect(evidence.selectedModule.name).toBe('Penalty + λ query encoder');
    expect(evidence.selectedModule.group).toContain('SPARKVSK learned warm path');
  });
});

describe('Model Builder server prompt boundary', () => {
  it('asks Codex to statically expand Python modules and preserve gradient uncertainty', () => {
    const prompt = buildModelBuilderPrompt([
      {
        name: 'film_network.py',
        kind: 'python',
        content:
          'class FiLM(nn.Module):\n    def forward(self, x, gamma, beta):\n        return gamma * x + beta',
      },
    ]);

    expect(prompt).toContain('Never execute uploaded code.');
    expect(prompt).toContain('conditional injection such as FiLM');
    expect(prompt).toContain('exact same block={id,label,repeatCount}');
    expect(prompt).toContain('short symbolic expression such as L-1');
    expect(prompt).toContain('repeat={count,label}');
    expect(prompt).toContain('runtime values, training results, or gradient measurements');
    expect(prompt).toContain('film_network.py');
    expect(prompt).toContain('gamma * x + beta');
  });

  it('includes extracted PDF text and a strict bounded ModelIR schema', () => {
    const prompt = buildModelBuilderPrompt(
      [
        {
          name: 'paper.pdf',
          kind: 'pdf',
          content: 'base64-is-not-injected-into-the-prompt',
        },
      ],
      { 'paper.pdf': 'Figure 2: encoder feeds a conditional residual decoder.' },
    );

    expect(prompt).toContain('PDF TEXT paper.pdf');
    expect(prompt).toContain('only when that text is insufficient');
    expect(prompt).toContain(`first ${MODEL_BUILDER_MAX_PDF_PAGES} pages`);
    expect(prompt).toContain('conditional residual decoder');
    expect(prompt).not.toContain('base64-is-not-injected-into-the-prompt');
    expect(MODEL_IR_OUTPUT_SCHEMA.additionalProperties).toBe(false);
    expect(MODEL_IR_OUTPUT_SCHEMA.properties.modules.maxItems).toBe(200);
    expect(MODEL_IR_OUTPUT_SCHEMA.properties.connections.maxItems).toBe(400);
    expect(MODEL_IR_OUTPUT_SCHEMA.properties.modules.items.required).toContain('block');
    expect(
      MODEL_IR_OUTPUT_SCHEMA.properties.modules.items.properties.block.anyOf[0].properties
        .repeatCount.anyOf[1].maxLength,
    ).toBe(32);
    expect(
      MODEL_IR_OUTPUT_SCHEMA.properties.modules.items.properties.repeat.anyOf[0].properties.count
        .anyOf[0].minimum,
    ).toBe(2);
    expect(
      MODEL_IR_OUTPUT_SCHEMA.properties.modules.items.properties.repeat.anyOf[0].properties.count
        .anyOf[0].maximum,
    ).toBe(128);
  });

  it('keeps every object property required for Codex strict structured output', () => {
    expectEveryObjectPropertyRequired(MODEL_IR_OUTPUT_SCHEMA);
    expect(MODEL_IR_OUTPUT_SCHEMA.properties.modules.items.required).toContain('repeat');
    expect(MODEL_IR_OUTPUT_SCHEMA.properties.modules.items.required).toContain('block');
    expect(MODEL_IR_OUTPUT_SCHEMA.properties.modules.items.properties.repeat.anyOf[1]).toEqual({
      type: 'null',
    });
  });

  it('renders a bounded number of PDF pages as diagram images for multimodal reconstruction', () => {
    expect(pdfPageRenderArguments('/tmp/paper.pdf', '/tmp/page')).toEqual([
      '-f',
      '1',
      '-l',
      '6',
      '-r',
      '120',
      '-png',
      '/tmp/paper.pdf',
      '/tmp/page',
    ]);
  });

  it('uses extracted architecture text without adding redundant PDF page images', () => {
    const extractedArchitecture = [
      'X_c: [N,P]',
      'y_c: [N,1]',
      "H = X_c'y_c / N: [P,1]",
      'H -> Linear(1,d): [P,d]',
      'H1 = soft-threshold(H1; exp(H2 - 2))',
      'H3 = concat([H1,H2], dim=1)',
      'H3 -> Linear(d,d) -> GELU -> RMSNorm(d) -> Linear(d,d)',
      'beta_out = soft-threshold(beta_init; tau): [P,K]',
    ].join('\n');

    expect(shouldAttachPdfRenders(extractedArchitecture)).toBe(false);
    expect(shouldAttachPdfRenders('Figure 2 contains the model architecture.')).toBe(true);
  });

  it('runs one isolated medium-reasoning Codex reconstruction with a bounded timeout', () => {
    const plan = modelBuilderCodexExecutionPlan({
      executable: '/opt/codex',
      schemaPath: '/tmp/model-ir-schema.json',
      resultPath: '/tmp/model-ir-result.json',
      imagePaths: ['/tmp/page-1.png'],
      prompt: 'reconstruct this model',
      cwd: '/tmp/model-builder',
    });

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      executable: '/opt/codex',
      prompt: 'reconstruct this model',
      timeoutMs: MODEL_BUILDER_TIMEOUT_MS,
      cwd: '/tmp/model-builder',
    });
    expect(MODEL_BUILDER_TIMEOUT_MS).toBe(300_000);
    expect(MODEL_BUILDER_REASONING).toBe('medium');
    expect(plan[0]?.args.filter((argument) => argument === '--ignore-user-config')).toHaveLength(1);
    expect(plan[0]?.args).toContain(`model_reasoning_effort="${MODEL_BUILDER_REASONING}"`);
    expect(plan[0]?.args).toContain('/tmp/page-1.png');
  });

  it('replaces raw Codex process codes with actionable import errors', () => {
    expect(modelBuilderUserFacingError('model_copilot_codex_exit_1')).toContain(
      'The PDF was read successfully',
    );
    expect(modelBuilderUserFacingError('model_copilot_timeout')).toContain('within 5 minutes');
  });

  it('extracts DOCX paragraphs, line breaks, tabs, tables, and XML entities as bounded text', () => {
    const documentXml = [
      '<w:document><w:body>',
      '<w:p><w:r><w:t>Encoder &amp; conditioner</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>FiLM</w:t><w:tab/><w:t>gamma * h + beta</w:t><w:br/><w:t>Residual</w:t></w:r></w:p>',
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Input</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>[B, D]</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
      '</w:body></w:document>',
    ].join('');

    expect(extractDocxText(documentXml)).toContain('Encoder & conditioner');
    expect(extractDocxText(documentXml)).toContain('FiLM\tgamma * h + beta\nResidual');
    expect(extractDocxText(documentXml)).toContain('Input\n\t[B, D]');
  });

  it('injects extracted DOCX text into the reconstruction prompt without base64 data', () => {
    const prompt = buildModelBuilderPrompt(
      [{ name: 'architecture.docx', kind: 'docx', content: 'base64-binary-content' }],
      { 'architecture.docx': 'Two residual blocks followed by a FiLM conditioner.' },
    );

    expect(prompt).toContain('DOCX TEXT architecture.docx');
    expect(prompt).toContain('Two residual blocks followed by a FiLM conditioner.');
    expect(prompt).not.toContain('base64-binary-content');
    expect(prompt).toContain('paragraphs and table-cell text');
  });
});
