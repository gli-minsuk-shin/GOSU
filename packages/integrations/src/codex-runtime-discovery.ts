import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, posix, win32 } from 'node:path';

type Version = readonly [number, number, number];
/** A release, or a prerelease of it such as `0.154.0-alpha.6.2`. */
type RuntimeVersion = Readonly<{ version: Version; prerelease: readonly string[] | null }>;

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

function runtimeVersion(output: string | null): RuntimeVersion | null {
  const match = output
    ?.trim()
    .match(
      /^codex(?:-cli)?\s+v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+){0,7}))?(?:\+[\w.-]+)?$/m,
    );
  if (!match) return null;
  const version = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (!version.every(Number.isSafeInteger)) return null;
  return { version, prerelease: match[4] ? match[4].split('.') : null };
}

/** Semantic-version order: a prerelease sorts below its own release and above older releases. */
function compareVersions(left: RuntimeVersion, right: RuntimeVersion) {
  const release =
    left.version[0] - right.version[0] ||
    left.version[1] - right.version[1] ||
    left.version[2] - right.version[2];
  if (release !== 0) return release;
  if (!left.prerelease || !right.prerelease) return left.prerelease ? -1 : right.prerelease ? 1 : 0;
  for (
    let index = 0;
    index < Math.max(left.prerelease.length, right.prerelease.length);
    index += 1
  ) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
    const numeric = [/^\d+$/u.test(a), /^\d+$/u.test(b)] as const;
    const order =
      numeric[0] && numeric[1]
        ? Number(a) - Number(b)
        : numeric[0] !== numeric[1]
          ? numeric[0]
            ? -1
            : 1
          : a < b
            ? -1
            : a > b
              ? 1
              : 0;
    if (order !== 0) return order;
  }
  return 0;
}

/**
 * macOS package managers install Codex as a `#!/usr/bin/env node` script beside their `node`. An
 * app opened from Finder has neither directory on PATH, so such a runtime is looked up by its
 * absolute path and started with its own directory first on PATH.
 */
const MACOS_PACKAGE_MANAGER_RUNTIMES = ['/opt/homebrew/bin/codex', '/usr/local/bin/codex'] as const;

export function codexRuntimeEnvironment(
  executable: string,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (!(MACOS_PACKAGE_MANAGER_RUNTIMES as readonly string[]).includes(executable)) {
    return environment;
  }
  const directory = dirname(executable);
  const entries = (environment.PATH ?? '').split(delimiter).filter(Boolean);
  return entries.includes(directory) || !isAbsolute(directory)
    ? environment
    : { ...environment, PATH: [directory, ...entries].join(delimiter) };
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

/**
 * Select the newest installed runtime of the bundled runtime's major version once per connection;
 * never download or restart a session. The model list comes from the service and depends on the
 * client version, so an old bundled runtime hides newly released models. Prerelease builds count:
 * the ChatGPT app ships them for weeks at a time, and refusing them silently dropped GOSU back to
 * the bundled runtime and its shorter model list.
 */
export async function resolveInstalledCodexExecutable(
  options: CodexRuntimeDiscoveryOptions,
  dependencies: Readonly<{
    probeVersion?: VersionProbe;
    platform?: NodeJS.Platform;
    userHome?: string;
    environment?: NodeJS.ProcessEnv;
  }> = {},
): Promise<string> {
  const explicit = options.explicitExecutable?.trim();
  if (explicit) return explicit;

  const probe = dependencies.probeVersion ?? probeVersion;
  const platform = dependencies.platform ?? process.platform;
  const userHome = dependencies.userHome ?? homedir();
  const environment = dependencies.environment ?? process.env;
  const candidates = [
    options.fallbackExecutable,
    'codex',
    ...(platform === 'darwin'
      ? [
          ...MACOS_PACKAGE_MANAGER_RUNTIMES,
          ...['Codex.app', 'ChatGPT.app'].flatMap((app) => [
            join('/Applications', app, 'Contents', 'Resources', 'codex'),
            join(userHome, 'Applications', app, 'Contents', 'Resources', 'codex'),
          ]),
        ]
      : []),
  ];
  const results = await Promise.all(
    [...new Set(candidates)].map(async (executable) => {
      const fallback = executable === options.fallbackExecutable;
      try {
        const packaged = codexRuntimeEnvironment(executable, environment);
        return {
          executable,
          version: runtimeVersion(
            await probe(
              executable,
              fallback ? (options.fallbackArgs ?? []) : [],
              fallback
                ? options.fallbackEnvironment
                : packaged === environment
                  ? undefined
                  : packaged,
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
    if (baseline && candidate.version.version[0] !== baseline.version[0]) continue;
    if (!chosen?.version || compareVersions(candidate.version, chosen.version) > 0) {
      chosen = candidate;
    }
  }
  return chosen?.executable ?? options.fallbackExecutable;
}
