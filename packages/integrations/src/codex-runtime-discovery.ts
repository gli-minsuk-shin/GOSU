import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix, win32 } from 'node:path';

type Version = readonly [number, number, number];

/** Shared GOSU login/config scope; credentials stay in place and are never copied. */
export function resolveGosuCodexHome(
  options: Readonly<{
    userDataDirectory?: string;
    userHome?: string;
    platform?: NodeJS.Platform;
    environment?: NodeJS.ProcessEnv;
    authFileExists?: (path: string) => boolean;
  }> = {},
): string {
  const platform = options.platform ?? process.platform;
  const path = platform === 'win32' ? win32 : posix;
  const environment = options.environment ?? process.env;
  const override = environment.GOSU_CODEX_HOME?.trim();
  if (override) {
    if (!path.isAbsolute(override)) throw new Error('gosu_codex_home_must_be_absolute');
    return path.normalize(override);
  }
  if (options.userDataDirectory) {
    if (!path.isAbsolute(options.userDataDirectory)) {
      throw new Error('gosu_user_data_directory_must_be_absolute');
    }
    return path.join(options.userDataDirectory, 'codex-project-chat');
  }
  const userHome = options.userHome ?? homedir();
  const configuredRoot = platform === 'win32' ? environment.APPDATA : environment.XDG_CONFIG_HOME;
  const appDataRoot =
    platform === 'darwin'
      ? path.join(userHome, 'Library', 'Application Support')
      : configuredRoot && path.isAbsolute(configuredRoot)
        ? configuredRoot
        : platform === 'win32'
          ? path.join(userHome, 'AppData', 'Roaming')
          : path.join(userHome, '.config');
  const candidates = [
    path.join(appDataRoot, 'GOSU', 'codex-project-chat'),
    // Earlier Desktop builds resolve userData before app.setName('GOSU'), so Electron caches
    // the package name's directory. Reuse that existing login instead of opening an empty one.
    path.join(appDataRoot, '@gosu', 'desktop', 'codex-project-chat'),
  ];
  const authFileExists = options.authFileExists ?? existsSync;
  return (
    candidates.find((candidate) => authFileExists(path.join(candidate, 'auth.json'))) ??
    candidates[0]!
  );
}

export type CodexRuntimeDiscoveryOptions = Readonly<{
  fallbackExecutable: string;
  fallbackArgs?: readonly string[];
  fallbackEnvironment?: NodeJS.ProcessEnv;
  explicitExecutable?: string;
}>;

type VersionProbe = (
  executable: string,
  args: readonly string[],
  environment?: NodeJS.ProcessEnv,
) => Promise<string | null>;

function stableVersion(output: string | null): Version | null {
  const match = output?.trim().match(/^codex(?:-cli)?\s+v?(\d+)\.(\d+)\.(\d+)(?:\+[\w.-]+)?$/m);
  if (!match) return null;
  const version = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  return version.every(Number.isSafeInteger) ? version : null;
}

function compareVersions(left: Version, right: Version) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

const probeVersion: VersionProbe = (executable, args, environment) =>
  new Promise((resolve) => {
    execFile(
      executable,
      [...args, '--version'],
      {
        timeout: 1_500,
        killSignal: 'SIGKILL',
        maxBuffer: 4_096,
        windowsHide: true,
        ...(environment ? { env: environment } : {}),
      },
      (error, stdout) => resolve(error ? null : stdout),
    );
  });

/** Select an installed stable runtime once per connection; never download or restart a session. */
export async function resolveInstalledCodexExecutable(
  options: CodexRuntimeDiscoveryOptions,
  dependencies: Readonly<{
    probeVersion?: VersionProbe;
    platform?: NodeJS.Platform;
    userHome?: string;
  }> = {},
): Promise<string> {
  const explicit = options.explicitExecutable?.trim();
  if (explicit) return explicit;

  const probe = dependencies.probeVersion ?? probeVersion;
  const platform = dependencies.platform ?? process.platform;
  const userHome = dependencies.userHome ?? homedir();
  const candidates = [
    options.fallbackExecutable,
    'codex',
    ...(platform === 'darwin'
      ? ['Codex.app', 'ChatGPT.app'].flatMap((app) => [
          join('/Applications', app, 'Contents', 'Resources', 'codex'),
          join(userHome, 'Applications', app, 'Contents', 'Resources', 'codex'),
        ])
      : []),
  ];
  const results = await Promise.all(
    [...new Set(candidates)].map(async (executable) => {
      const fallback = executable === options.fallbackExecutable;
      try {
        return {
          executable,
          version: stableVersion(
            await probe(
              executable,
              fallback ? (options.fallbackArgs ?? []) : [],
              fallback ? options.fallbackEnvironment : undefined,
            ),
          ),
        };
      } catch {
        return { executable, version: null };
      }
    }),
  );
  const baseline = results[0]?.version;
  let chosen = results[0];
  for (const candidate of results.slice(1)) {
    if (!candidate.version) continue;
    // A new major may change the App Server protocol. Keep the known fallback until supported.
    if (baseline && candidate.version[0] !== baseline[0]) continue;
    if (!chosen?.version || compareVersions(candidate.version, chosen.version) > 0) {
      chosen = candidate;
    }
  }
  return chosen?.executable ?? options.fallbackExecutable;
}
