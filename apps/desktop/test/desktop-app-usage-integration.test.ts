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
    expect(source).toContain('<UsageView');
    expect(source).toContain('adapter={usageAdapter}');
    expect(source).toContain('window.gosu.modelUsage.query(input)');
  });

  it('gives the Usage view the public price list and starts its daily refresh in the main process', () => {
    expect(source).toContain('prices: () => window.gosu.modelUsage.prices()');
    expect(source).toContain('refreshPrices: () => window.gosu.modelUsage.refreshPrices()');
    expect(mainSource).toContain("new ModelPriceCatalogStore(app.getPath('userData'))");
    expect(mainSource).toContain('modelPrices.start();');
    expect(mainSource).toContain('modelPrices.close();');
    const preload = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
    // Neither price call forwards anything from the page to the main process.
    expect(preload).toContain('ipcRenderer.invoke(MODEL_PRICE_IPC_CHANNELS.status)');
    expect(preload).toContain('ipcRenderer.invoke(MODEL_PRICE_IPC_CHANNELS.refresh)');
  });

  it('keeps the remaining plan limits in the main process and shows them in the title bar and the Usage screen', () => {
    expect(mainSource).toContain('read: () => codex.rateLimits()');
    expect(mainSource).toContain('connected: () => projectChatProvider.isClaudeCodeConnected()');
    expect(mainSource).toContain('usageLimits.start()');
    expect(mainSource).toContain('usageLimits.close();');
    expect(mainSource).toContain(
      'usageLimits.setActive(window.isVisible() && !window.isMinimized())',
    );
    expect(mainSource).toContain('usageLimits.acceptCodexNotification(method, params)');
    const preload = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
    // Status and "refresh now" forward nothing from the page; pushed statuses are validated.
    expect(preload).toContain('ipcRenderer.invoke(USAGE_LIMIT_IPC_CHANNELS.status)');
    expect(preload).toContain('ipcRenderer.invoke(USAGE_LIMIT_IPC_CHANNELS.refresh)');
    expect(preload).toContain('UsageLimitStatusSchema.safeParse(arguments_[0])');
    const titlebar = source.slice(source.indexOf('<header className="titlebar">'));
    expect(titlebar.indexOf('<UsageLimitPills')).toBeGreaterThan(-1);
    // The pills stay left of the AI line, which took the sync pill's place at the right end.
    expect(titlebar.indexOf('<UsageLimitPills')).toBeLessThan(
      titlebar.indexOf('<TitlebarAiStatus'),
    );
    expect(source).toContain("onOpen={() => selectGlobalTab('usage')}");
    // A service that connects or disconnects refreshes the limits at once.
    expect(source).toContain('`${codexConnectionState}:${claudeCodeProjectChatConnection.phase}`');
    const codexClient = readFileSync(
      new URL('../src/main/codex-app-server.ts', import.meta.url),
      'utf8',
    );
    expect(codexClient).toContain("this.request('account/rateLimits/read', undefined)");
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
