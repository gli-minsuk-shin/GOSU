import { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { setUiLanguage } from '@gosu/ui/language';
import { ProjectChatView } from '../../src/renderer/src/project-chat-view';
import { parseModelLabChatHandoff } from '../../src/renderer/src/project-model-lab-view';
import { defaultProjectChatProfile } from '../../src/shared/project-chat-contracts';
import type { ModelLabReference } from '../../../model-lab/model-reference-contracts';
import '../../src/renderer/src/styles.css';
setUiLanguage('ko');
const id = '11111111-1111-4111-8111-111111111111',
  now = '2026-09-14T00:00:00Z';
const project = {
  id,
  name: 'Synthetic Model Reference',
  slug: 'fixture',
  version: 1,
  createdAt: now,
  updatedAt: now,
};
const noop = () => undefined;
function Preview() {
  const [reference, setReference] = useState<ModelLabReference | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const url = new URL('./model-reference-child.html', window.location.href).href;
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const selected = parseModelLabChatHandoff(event, frame.current?.contentWindow ?? null, url);
      if (selected)
        setReference({
          ...selected,
          name: 'Bottleneck autoencoder',
          version: 'v1',
          contentSha256: 'a'.repeat(64),
        });
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [url]);
  return (
    <main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <strong>GOSU · UI fixture</strong>
        <button onClick={() => setReference(null)}>Model Lab</button>
        <span>{reference ? 'Project Chat' : 'No real accounts or provider calls'}</span>
      </header>
      <iframe
        ref={frame}
        src={url}
        title="Synthetic Model Lab"
        style={{ border: 0, width: '100%', flex: 1, display: reference ? 'none' : 'block' }}
      />
      {reference && (
        <section style={{ flex: 1, minHeight: 0, padding: 10 }}>
          <ProjectChatView
            project={project}
            tasks={[]}
            snapshot={{
              schemaVersion: 1,
              projectId: id,
              session: {
                id,
                projectId: id,
                title: 'Bottleneck autoencoder · r0',
                isDefault: false,
                modelLabReference: reference,
                createdAt: now,
                updatedAt: now,
              },
              messages: [],
              attempts: [],
              profile: defaultProjectChatProfile(id),
            }}
            loading={false}
            inFlight={false}
            models={[
              {
                providerId: 'codex',
                modelId: 'fixture',
                displayName: 'Fixture model',
                isDefault: true,
                reasoningOptions: [{ id: 'high', label: 'high', isDefault: true }],
              },
            ]}
            collaborationModes={[]}
            selectedProviderId="codex"
            selectedModel="fixture"
            selectedReasoning="high"
            applyingActionId={null}
            vault={null}
            vaultState="ready"
            onSelectedModel={noop}
            onSelectedReasoning={noop}
            onRefreshModels={noop}
            onOpenAgentSettings={noop}
            onSend={async () => false}
            onCancel={noop}
            onApplyAction={async () => undefined}
            chatDetailsCollapsed
            sessionRailCollapsed
          />
        </section>
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
