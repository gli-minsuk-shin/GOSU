import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
  'utf8',
);
const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');

describe('DesktopApp workspace Usage integration', () => {
  it('renders Usage through the strict local model-usage query API', () => {
    expect(source).toContain("activeTab === 'usage'");
    expect(source).toContain('<UsageView projects={snapshot.projects} adapter={usageAdapter} />');
    expect(source).toContain('window.gosu.modelUsage.query(input)');
  });

  it('registers usage collection before startup queued chats can begin', () => {
    const invocationListener = mainSource.indexOf('modelUsage.recordInvocation(event)');
    const usageListener = mainSource.indexOf('modelUsage.recordCodexNotification(notification)');
    const queuedTurnReconciliation = mainSource.indexOf('await projectChat.reconcileQueuedTurns()');

    expect(invocationListener).toBeGreaterThan(-1);
    expect(usageListener).toBeGreaterThan(-1);
    expect(queuedTurnReconciliation).toBeGreaterThan(-1);
    expect(invocationListener).toBeLessThan(queuedTurnReconciliation);
    expect(usageListener).toBeLessThan(queuedTurnReconciliation);
  });
});
