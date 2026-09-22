import { createRoot } from 'react-dom/client';
import '../../model-lab/node_modules/@xyflow/react/dist/style.css';
import 'katex/dist/katex.min.css';
import { ModelLabApp } from '../../model-lab/src/model-lab-app';
import { bottleneckAutoencoder } from '../../model-lab/src/sample-models';
import { formulaDisplayRows } from '../../model-lab/src/formula';
import {
  initialModelPseudocodeWorkspace,
  serializeModelPseudocodeWorkspace,
  MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY,
} from '../../model-lab/src/model-pseudocode';
import '../../model-lab/src/styles.css';
import '../../model-lab/src/model-lab-embedded.css';
import '../../model-lab/src/project-model-workspace.css';
const projectId = '11111111-1111-4111-8111-111111111111';
const config = document.createElement('script');
config.id = 'gosu-model-lab-host';
config.type = 'application/json';
config.textContent = JSON.stringify({
  projectId,
  projectName: 'Synthetic QA project',
  basePath: `/s/${'a'.repeat(64)}/${projectId}/`,
  storage: {
    'gosu.model-lab.project-scope.v1': '1',
    [MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY]: serializeModelPseudocodeWorkspace(
      initialModelPseudocodeWorkspace([
        {
          ...structuredClone(bottleneckAutoencoder),
          id: 'qa-a',
          name: 'Imported QA A',
          modules: bottleneckAutoencoder.modules.map((m) => ({
            ...m,
            presentation: {
              purpose: m.explanation,
              keyEquation: formulaDisplayRows(m.formula)[0]!,
              shapeNotes:
                'B is the batch axis; the feature axis follows the displayed IN/OUT contract.',
              uncertainties: ['Runtime execution has not been observed.'],
            },
          })),
        },
        { ...structuredClone(bottleneckAutoencoder), id: 'qa-b', name: 'Imported QA B' },
      ]),
    ),
  },
});
document.body.append(config);
let llmCalls = 0,
  handoffs = 0;
document.documentElement.dataset.qaLlmCalls = '0';
document.documentElement.dataset.qaHandoffs = '0';
window.addEventListener('message', (event) => {
  if (event.data?.type === 'gosu:model-lab:project-chat')
    document.documentElement.dataset.qaHandoffs = String(++handoffs);
});
window.fetch = async (input) => {
  const path = String(input);
  if (path.endsWith('/api/model-copilot')) {
    document.documentElement.dataset.qaLlmCalls = String(++llmCalls);
    return new Response('{}', { status: 503 });
  }
  const value = path.includes('/application-language')
    ? { language: 'ko', configured: true }
    : path.includes('/model-copilot/status')
      ? { available: false, provider: 'Synthetic', model: 'none', reasoning: 'none' }
      : path.includes('/model-copilot/models')
        ? {
            schemaVersion: 1,
            providerId: 'codex',
            catalogVersion: 'qa',
            fetchedAt: new Date().toISOString(),
            models: [],
          }
        : { messages: [], revision: 0, copies: [], projects: [] };
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
};
createRoot(document.getElementById('root')!).render(<ModelLabApp />);
