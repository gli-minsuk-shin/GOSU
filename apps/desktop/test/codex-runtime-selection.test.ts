import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveInstalledCodexExecutable } from '@gosu/integrations/codex-runtime-discovery';

import { resolveCodexCommand } from '../src/main/codex-app-server';

vi.mock('@gosu/integrations/codex-runtime-discovery', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveInstalledCodexExecutable: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('desktop Codex runtime selection', () => {
  it('runs the shared discovered native binary without Electron Node-mode flags', async () => {
    vi.stubEnv('GOSU_CODEX_BIN', '');
    vi.mocked(resolveInstalledCodexExecutable).mockResolvedValue(
      '/Applications/ChatGPT.app/Contents/Resources/codex',
    );
    await expect(resolveCodexCommand()).resolves.toEqual({
      executable: '/Applications/ChatGPT.app/Contents/Resources/codex',
      prefixArgs: [],
      runAsNode: false,
    });
    expect(resolveInstalledCodexExecutable).toHaveBeenCalledWith({
      fallbackExecutable: process.execPath,
      fallbackArgs: [expect.stringMatching(/bin\/codex\.js$/)],
      fallbackEnvironment: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }),
    });
  });

  it('keeps the bundled entrypoint executable when no newer installed runtime is available', async () => {
    vi.stubEnv('GOSU_CODEX_BIN', '');
    vi.mocked(resolveInstalledCodexExecutable).mockResolvedValue(process.execPath);
    await expect(resolveCodexCommand()).resolves.toEqual({
      executable: process.execPath,
      prefixArgs: [expect.stringMatching(/bin\/codex\.js$/)],
      runAsNode: true,
    });
  });

  it('can resolve the bundled runtime alone, for the retry after an installed one fails to start', async () => {
    vi.stubEnv('GOSU_CODEX_BIN', '');
    vi.mocked(resolveInstalledCodexExecutable).mockResolvedValue(
      '/Applications/ChatGPT.app/Contents/Resources/codex',
    );
    await expect(resolveCodexCommand({ bundledOnly: true })).resolves.toEqual({
      executable: process.execPath,
      prefixArgs: [expect.stringMatching(/bin\/codex\.js$/)],
      runAsNode: true,
    });
    expect(resolveInstalledCodexExecutable).not.toHaveBeenCalled();
  });

  it('honors an explicitly configured binary before automatic discovery', async () => {
    vi.stubEnv('GOSU_CODEX_BIN', '/explicit/codex');
    await expect(resolveCodexCommand()).resolves.toEqual({
      executable: '/explicit/codex',
      prefixArgs: [],
      runAsNode: false,
    });
    expect(resolveInstalledCodexExecutable).not.toHaveBeenCalled();
  });
});
