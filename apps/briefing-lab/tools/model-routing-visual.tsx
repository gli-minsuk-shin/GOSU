import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultModelRouting } from '@gosu/contracts';
import { ModelRoutingSettings } from '../../desktop/src/renderer/src/model-routing-settings';
import '../../desktop/src/renderer/src/styles.css';
const models = [
  {
    providerId: 'codex',
    modelId: 'fixture-light',
    displayName: 'Light model · 검증용',
    isDefault: false,
    reasoningOptions: [{ id: 'low', label: 'Low', isDefault: true }],
  },
  {
    providerId: 'codex',
    modelId: 'fixture-fast',
    displayName: 'Fast model · 검증용',
    isDefault: false,
    reasoningOptions: [{ id: 'low', label: 'Low', isDefault: true }],
  },
  {
    providerId: 'codex',
    modelId: 'fixture-deep',
    displayName: 'Research model · 검증용',
    isDefault: true,
    reasoningOptions: [{ id: 'high', label: 'High', isDefault: true }],
  },
];
function Fixture() {
  const [policy, setPolicy] = useState(defaultModelRouting);
  return (
    <main style={{ padding: 20, maxWidth: 920, margin: 'auto', width: '100%' }}>
      <ModelRoutingSettings
        policy={policy}
        models={models}
        loading={false}
        onRefresh={() => undefined}
        onSave={async (next) => {
          setPolicy(next);
        }}
      />
    </main>
  );
}
document.documentElement.dataset.appearance = 'light';
createRoot(document.getElementById('root')!).render(<Fixture />);
