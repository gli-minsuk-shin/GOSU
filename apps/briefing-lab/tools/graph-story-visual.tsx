import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelGraph } from '../../model-lab/src/model-graph';
import { Formula } from '../../model-lab/src/formula';
import { englishGraphName } from '../../model-lab/src/graph-presentation';
import type { ModelSpec, ModelModule } from '../../model-lab/src/model-lab-schema';
import '../../model-lab/node_modules/@xyflow/react/dist/style.css';
import 'katex/dist/katex.min.css';
import '../../model-lab/src/styles.css';
function Preview({ model }: { model: ModelSpec }) {
  const [selected, setSelected] = useState(model.modules[0]!.id),
    [detail, setDetail] = useState<ModelModule | null>(null);
  return (
    <main
      className="model-lab-shell--focus"
      style={{
        padding: 16,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{englishGraphName(model.name, model.id)}</h2>
        <span>Structure first · click a stage for equations and exact ports</span>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ModelGraph
          composition={{ model, expansions: [], subgraphTargets: {} }}
          selectedModuleId={selected}
          probe="healthy"
          checkpointIndex={0}
          signalMode="forward"
          focusMode
          openModuleId={detail?.id ?? null}
          onSelectModule={setSelected}
          onOpenModule={setDetail}
          onToggleSubgraph={() => undefined}
        />
      </div>
      {detail && (
        <aside
          style={{
            position: 'fixed',
            right: 16,
            top: 16,
            bottom: 16,
            width: 480,
            overflow: 'auto',
            zIndex: 100,
            background: 'white',
            border: '1px solid #cad4c3',
            borderRadius: 16,
            padding: 24,
            boxShadow: '0 12px 60px #0003',
          }}
        >
          <button onClick={() => setDetail(null)}>Close</button>
          <h2>{englishGraphName(detail.name, detail.id)}</h2>
          <p>{detail.explanation}</p>
          <Formula latex={detail.formula} />
          <pre>
            {JSON.stringify({ inputs: detail.inputPorts, outputs: detail.outputPorts }, null, 2)}
          </pre>
        </aside>
      )}
    </main>
  );
}
const key = new URL(location.href).searchParams.get('key');
const result = await fetch(`/__graph-qa/${key}`);
if (!result.ok) throw Error('Preview unavailable');
createRoot(document.getElementById('root')!).render(<Preview model={await result.json()} />);
