import { describe, expect, it, vi } from 'vitest';

import {
  codexRuntimeEnvironment,
  resolveGosuCodexHome,
  resolveInstalledCodexExecutable,
} from '../src/codex-runtime-discovery.js';

const appRuntime = '/Applications/ChatGPT.app/Contents/Resources/codex';
const codexRuntime = '/Applications/Codex.app/Contents/Resources/codex';
const homebrewRuntime = '/opt/homebrew/bin/codex';
const fallbackExecutable = '/bundled/node';

describe('shared GOSU Codex login scope', () => {
  it('resolves the same macOS home for standalone Model Lab and Electron GOSU', () => {
    const options = {
      platform: 'darwin' as const,
      userHome: '/Users/fixture',
      environment: {},
      authFileExists: () => false,
    };
    const standalone = resolveGosuCodexHome(options);
    const desktop = resolveGosuCodexHome({
      ...options,
      userDataDirectory: '/Users/fixture/Library/Application Support/GOSU',
    });
    expect(standalone).toBe(desktop);
    expect(standalone).toBe('/Users/fixture/Library/Application Support/GOSU/codex-project-chat');
    expect(standalone).not.toContain('/.codex');
  });

  it('supports native application-data roots on Linux and Windows', () => {
    expect(
      resolveGosuCodexHome({
        platform: 'linux',
        userHome: '/home/fixture',
        environment: {},
        authFileExists: () => false,
      }),
    ).toBe('/home/fixture/.config/GOSU/codex-project-chat');
    expect(
      resolveGosuCodexHome({
        platform: 'linux',
        userHome: '/home/fixture',
        environment: { XDG_CONFIG_HOME: '/data/config' },
        authFileExists: () => false,
      }),
    ).toBe('/data/config/GOSU/codex-project-chat');
    expect(
      resolveGosuCodexHome({
        platform: 'win32',
        userHome: 'C:\\Users\\fixture',
        environment: { APPDATA: 'D:\\AppData' },
        authFileExists: () => false,
      }),
    ).toBe('D:\\AppData\\GOSU\\codex-project-chat');
  });

  it('reuses the legacy Electron package-name login if the renamed app home has no auth', () => {
    const legacy = '/Users/fixture/Library/Application Support/@gosu/desktop/codex-project-chat';
    const authFileExists = vi.fn((path: string) => path === `${legacy}/auth.json`);
    expect(
      resolveGosuCodexHome({
        platform: 'darwin',
        userHome: '/Users/fixture',
        environment: {},
        authFileExists,
      }),
    ).toBe(legacy);
    expect(authFileExists.mock.calls.map(([path]) => path)).toEqual([
      '/Users/fixture/Library/Application Support/GOSU/codex-project-chat/auth.json',
      `${legacy}/auth.json`,
    ]);
    expect(
      resolveGosuCodexHome({
        platform: 'darwin',
        userDataDirectory: '/explicit/electron-user-data',
        environment: {},
        authFileExists,
      }),
    ).toBe('/explicit/electron-user-data/codex-project-chat');
  });

  it('prefers the current app login when both bounded homes contain auth', () => {
    expect(
      resolveGosuCodexHome({
        platform: 'darwin',
        userHome: '/Users/fixture',
        environment: {},
        authFileExists: () => true,
      }),
    ).toBe('/Users/fixture/Library/Application Support/GOSU/codex-project-chat');
  });

  it('honors only an explicit absolute shared override, never inherited generic CODEX_HOME', () => {
    expect(
      resolveGosuCodexHome({
        platform: 'darwin',
        userHome: '/Users/fixture',
        environment: { GOSU_CODEX_HOME: '/shared/gosu-codex', CODEX_HOME: '/unrelated' },
      }),
    ).toBe('/shared/gosu-codex');
    expect(() =>
      resolveGosuCodexHome({ environment: { GOSU_CODEX_HOME: '../other-login' } }),
    ).toThrow('gosu_codex_home_must_be_absolute');
  });
});

function fixture(versions: Record<string, string | null>) {
  return {
    platform: 'darwin' as const,
    userHome: '/fixture',
    // An app opened from Finder: no package-manager directory on PATH.
    environment: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } as NodeJS.ProcessEnv,
    probeVersion: vi.fn(
      async (executable: string, _args?: readonly string[], _environment?: NodeJS.ProcessEnv) =>
        versions[executable] ?? null,
    ),
  };
}

describe('installed Codex runtime discovery', () => {
  it('selects the highest stable installed version without any model-name mapping', async () => {
    const dependencies = fixture({
      [fallbackExecutable]: 'codex-cli 0.149.0',
      codex: 'codex-cli 0.152.9',
      [codexRuntime]: 'codex-cli 0.153.0',
      [appRuntime]: 'codex-cli 0.160.12',
    });
    await expect(
      resolveInstalledCodexExecutable({ fallbackExecutable }, dependencies),
    ).resolves.toBe(appRuntime);
  });

  it('probes bundled Node entrypoints with their prefix and environment', async () => {
    const dependencies = fixture({ [fallbackExecutable]: 'codex-cli 0.149.0' });
    const fallbackEnvironment = { ELECTRON_RUN_AS_NODE: '1' };
    await expect(
      resolveInstalledCodexExecutable(
        { fallbackExecutable, fallbackArgs: ['/bundled/codex.js'], fallbackEnvironment },
        dependencies,
      ),
    ).resolves.toBe(fallbackExecutable);
    expect(dependencies.probeVersion).toHaveBeenCalledWith(
      fallbackExecutable,
      ['/bundled/codex.js'],
      fallbackEnvironment,
    );
  });

  it('retains the bundled runtime when installed candidates are older or another major version', async () => {
    const dependencies = fixture({
      [fallbackExecutable]: 'codex-cli 0.149.0',
      codex: 'codex-cli 0.99.0',
      [codexRuntime]: 'codex-cli 1.4.0-beta.1',
      [appRuntime]: 'codex-cli 1.0.0',
    });
    await expect(
      resolveInstalledCodexExecutable({ fallbackExecutable }, dependencies),
    ).resolves.toBe(fallbackExecutable);
  });

  it('uses a newer prerelease build so models released after the bundled runtime stay listed', async () => {
    // The ChatGPT app ships alpha builds for weeks. Refusing them dropped GOSU to the bundled
    // 0.149.0, whose model list from the service has no GPT-6-Astra.
    await expect(
      resolveInstalledCodexExecutable(
        { fallbackExecutable },
        fixture({
          [fallbackExecutable]: 'codex-cli 0.149.0',
          [appRuntime]: 'codex-cli 0.154.0-alpha.6.2',
        }),
      ),
    ).resolves.toBe(appRuntime);
    // A newer prerelease outranks an older release…
    await expect(
      resolveInstalledCodexExecutable(
        { fallbackExecutable },
        fixture({
          [fallbackExecutable]: 'codex-cli 0.149.0',
          [homebrewRuntime]: 'codex-cli 0.153.4',
          [appRuntime]: 'codex-cli 0.154.0-alpha.6.2',
        }),
      ),
    ).resolves.toBe(appRuntime);
    // …a release outranks its own prerelease…
    await expect(
      resolveInstalledCodexExecutable(
        { fallbackExecutable },
        fixture({
          [fallbackExecutable]: 'codex-cli 0.154.0',
          [appRuntime]: 'codex-cli 0.154.0-alpha.6.2',
        }),
      ),
    ).resolves.toBe(fallbackExecutable);
    // …and prerelease identifiers compare numerically, not as text.
    await expect(
      resolveInstalledCodexExecutable(
        { fallbackExecutable },
        fixture({
          [fallbackExecutable]: 'codex-cli 0.149.0',
          [codexRuntime]: 'codex-cli 0.154.0-alpha.10',
          [appRuntime]: 'codex-cli 0.154.0-alpha.6.2',
        }),
      ),
    ).resolves.toBe(codexRuntime);
    await expect(
      resolveInstalledCodexExecutable(
        { fallbackExecutable },
        fixture({
          [fallbackExecutable]: 'codex-cli 0.149.0',
          [appRuntime]: 'codex-cli 0.154.0-alpha/../../evil',
        }),
      ),
    ).resolves.toBe(fallbackExecutable);
  });

  it('finds a Homebrew runtime by absolute path and runs it with its own directory on PATH', async () => {
    // An app opened from Finder has no /opt/homebrew/bin on PATH, and that codex is a
    // `#!/usr/bin/env node` script whose node lives beside it.
    const dependencies = fixture({
      [fallbackExecutable]: 'codex-cli 0.149.0',
      [homebrewRuntime]: 'codex-cli 0.153.4',
    });
    await expect(
      resolveInstalledCodexExecutable({ fallbackExecutable }, dependencies),
    ).resolves.toBe(homebrewRuntime);
    const probe = dependencies.probeVersion.mock.calls.find(([path]) => path === homebrewRuntime)!;
    expect((probe[2] as NodeJS.ProcessEnv).PATH?.split(':')[0]).toBe('/opt/homebrew/bin');
    // Native runtimes and PATH lookups keep the caller's environment.
    expect(
      dependencies.probeVersion.mock.calls.find(([path]) => path === appRuntime)![2],
    ).toBeUndefined();
    const finder = { PATH: '/usr/bin:/bin', HOME: '/Users/fixture' };
    expect(codexRuntimeEnvironment(homebrewRuntime, finder)).toEqual({
      PATH: '/opt/homebrew/bin:/usr/bin:/bin',
      HOME: '/Users/fixture',
    });
    expect(
      codexRuntimeEnvironment('/usr/local/bin/codex', { PATH: '/usr/local/bin:/bin' }),
    ).toEqual({ PATH: '/usr/local/bin:/bin' });
    expect(codexRuntimeEnvironment(appRuntime, finder)).toBe(finder);
    expect(codexRuntimeEnvironment('codex', finder)).toBe(finder);
  });

  it('ignores missing, failed and malformed version probes', async () => {
    const dependencies = fixture({ [appRuntime]: 'not a Codex CLI version: 999.0.0' });
    dependencies.probeVersion.mockRejectedValueOnce(new Error('ENOENT'));
    await expect(
      resolveInstalledCodexExecutable({ fallbackExecutable }, dependencies),
    ).resolves.toBe(fallbackExecutable);
  });

  it('uses an installed runtime if the default PATH command is missing', async () => {
    const dependencies = fixture({ [appRuntime]: 'codex-cli 0.153.0' });
    await expect(
      resolveInstalledCodexExecutable({ fallbackExecutable: 'codex' }, dependencies),
    ).resolves.toBe(appRuntime);
    expect(dependencies.probeVersion.mock.calls.filter(([path]) => path === 'codex')).toHaveLength(
      1,
    );
  });

  it('preserves an explicit executable pin without probing or falling back silently', async () => {
    const dependencies = fixture({ [appRuntime]: 'codex-cli 0.153.0' });
    await expect(
      resolveInstalledCodexExecutable(
        { fallbackExecutable, explicitExecutable: ' /explicit/missing-or-older-codex ' },
        dependencies,
      ),
    ).resolves.toBe('/explicit/missing-or-older-codex');
    expect(dependencies.probeVersion).not.toHaveBeenCalled();
  });

  it('keeps the fallback on equal versions and compares version components numerically', async () => {
    const dependencies = fixture({
      [fallbackExecutable]: 'codex-cli 0.149.9',
      codex: 'codex-cli 0.149.10',
      [appRuntime]: 'codex-cli 0.149.9',
    });
    await expect(
      resolveInstalledCodexExecutable({ fallbackExecutable }, dependencies),
    ).resolves.toBe('codex');
    dependencies.probeVersion.mockImplementation(async () => 'codex-cli 0.149.9');
    await expect(
      resolveInstalledCodexExecutable({ fallbackExecutable }, dependencies),
    ).resolves.toBe(fallbackExecutable);
  });

  it('only checks PATH and the fallback on platforms without these application bundles', async () => {
    const dependencies = { ...fixture({ codex: 'codex-cli 0.153.0' }), platform: 'linux' as const };
    await expect(
      resolveInstalledCodexExecutable({ fallbackExecutable }, dependencies),
    ).resolves.toBe('codex');
    expect(dependencies.probeVersion).toHaveBeenCalledTimes(2);
  });
});
