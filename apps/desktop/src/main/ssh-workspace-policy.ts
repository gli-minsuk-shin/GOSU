import { posix } from 'node:path';

import {
  SSH_WORKSPACE_MAX_ARGUMENTS,
  type RemoteWorkspaceGrant,
  type SshWorkspaceAgentCommand,
  type SshWorkspaceOperationClass,
} from '../shared/ssh-workspace-contracts';
import { SSH_COMMAND_MAX_TIMEOUT_SECONDS } from '../shared/ssh-contracts';

/*
 * Keep this stricter than the general direct-argv boundary. Experiment arguments are intentionally
 * plain values rather than shell fragments, response files, or interpreter switches.
 */
const PYTHON_EXPERIMENT_SHELL_META_PATTERN = /[\n\r\0`$&|;<>()[\]{}*?!~@'"\\]/u;

const ALLOWED_EXECUTABLE_DIRECTORIES = new Set(['/bin', '/usr/bin']);

const FORBIDDEN_EXECUTABLES = new Set([
  'bash',
  'curl',
  'dash',
  'doas',
  'env',
  'fish',
  'perl',
  'rsync',
  'scp',
  'sh',
  'ssh',
  'su',
  'sudo',
  'wget',
  'xargs',
  'zsh',
]);

const SHELL_META_PATTERN = /[\n\r\0`]|\$\(|\$\{|&&|\|\||[<>|;]/u;
const PYTHON_EXPERIMENT_ENTRYPOINT_PATTERN =
  /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.py$/u;

function executableBasename(command: string) {
  const directory = posix.dirname(command);
  const basename = posix.basename(command);
  if (!ALLOWED_EXECUTABLE_DIRECTORIES.has(directory)) return null;
  if (!/^[a-z0-9][a-z0-9+._-]*$/u.test(basename)) return null;
  return basename;
}

export function resolveWorkspaceWorkingDirectory(
  canonicalRoot: string,
  subdirectory: string | undefined,
) {
  if (!subdirectory) return canonicalRoot;
  const candidate = posix.join(canonicalRoot, subdirectory);
  return candidate.startsWith(`${canonicalRoot}/`) ? candidate : null;
}

function argumentStaysInWorkspace(argument: string, canonicalRoot: string) {
  if (SHELL_META_PATTERN.test(argument)) return false;
  const values =
    argument.startsWith('--') && argument.includes('=')
      ? [argument.slice(argument.indexOf('=') + 1)]
      : [argument];
  return values.every(
    (value) =>
      value !== '..' &&
      !value.startsWith('../') &&
      !value.endsWith('/..') &&
      !value.includes('/../') &&
      (!value.startsWith('/') || value === canonicalRoot || value.startsWith(`${canonicalRoot}/`)),
  );
}

function hasForbiddenInlineEvaluation(basename: string, arguments_: readonly string[]) {
  if (basename === 'python' || basename === 'python3') {
    return arguments_.some((argument) => argument === '-c' || argument === '--command');
  }
  if (basename === 'node') {
    return arguments_.some((argument) =>
      ['-e', '--eval', '-p', '--print', '-i', '--interactive', '-r', '--require'].includes(
        argument,
      ),
    );
  }
  return false;
}

function classifyGit(arguments_: readonly string[]): SshWorkspaceOperationClass | null {
  const normalized = [...arguments_];
  while (
    ['--no-pager', '--literal-pathspecs', '--no-optional-locks'].includes(normalized[0] ?? '')
  ) {
    normalized.shift();
  }
  const [subcommand, ...rest] = normalized;
  if (!subcommand) return null;
  if (subcommand === 'status') {
    return rest.every(
      (argument) =>
        ['--short', '--branch', '--show-stash', '--no-renames', '--porcelain=v1'].includes(
          argument,
        ) ||
        /^--untracked-files=(?:no|normal|all)$/u.test(argument) ||
        /^--ignored=(?:no|traditional|matching)$/u.test(argument),
    )
      ? 'inspect'
      : null;
  }
  if (subcommand === 'diff') {
    return rest.every(
      (argument) =>
        !argument.startsWith('-') ||
        [
          '--',
          '--stat',
          '--numstat',
          '--shortstat',
          '--name-only',
          '--name-status',
          '--cached',
          '--staged',
        ].includes(argument),
    )
      ? 'inspect'
      : null;
  }
  if (subcommand === 'log') {
    return rest.every(
      (argument) =>
        !argument.startsWith('-') ||
        ['--', '--oneline', '--decorate=no', '--no-decorate', '--all'].includes(argument) ||
        /^--max-count=[1-9][0-9]{0,2}$/u.test(argument),
    )
      ? 'inspect'
      : null;
  }
  if (subcommand === 'ls-files') {
    return rest.every(
      (argument) =>
        !argument.startsWith('-') ||
        ['--', '--cached', '--deleted', '--modified', '--others', '--exclude-standard'].includes(
          argument,
        ),
    )
      ? 'inspect'
      : null;
  }
  if (subcommand === 'show') {
    const object = rest[0];
    const path = object?.startsWith('HEAD:') ? object.slice('HEAD:'.length) : '';
    return rest.length === 1 &&
      path.length > 0 &&
      path.length <= 512 &&
      !path.startsWith('/') &&
      path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
      ? 'inspect'
      : null;
  }
  if (subcommand === 'rev-parse') {
    return rest.length > 0 &&
      rest.every((argument) =>
        [
          'HEAD',
          '--show-toplevel',
          '--show-prefix',
          '--is-inside-work-tree',
          '--abbrev-ref',
        ].includes(argument),
      )
      ? 'inspect'
      : null;
  }
  return null;
}

function hasBlockedLauncherOption(basename: string, arguments_: readonly string[]) {
  if (basename === 'pytest' || basename === 'python' || basename === 'python3') {
    return arguments_.some(
      (argument) =>
        ['-c', '-p', '-o', '--basetemp', '--confcutdir', '--rootdir', '--override-ini'].includes(
          argument,
        ) || /^--(?:basetemp|confcutdir|rootdir|override-ini)=/u.test(argument),
    );
  }
  if (basename === 'go') {
    return arguments_.some((argument) =>
      /^-(?:exec|toolexec|overlay|modfile)(?:=|$)/u.test(argument),
    );
  }
  if (basename === 'make') {
    return arguments_.some(
      (argument) =>
        /^-(?:C|f|I).+/u.test(argument) ||
        ['-C', '-f', '-I', '--directory', '--file', '--makefile', '--include-dir'].includes(
          argument,
        ) ||
        /^--(?:directory|file|makefile|include-dir)=/u.test(argument),
    );
  }
  return false;
}

function classifyTestOrBuild(
  basename: string,
  arguments_: readonly string[],
): SshWorkspaceOperationClass | null {
  if (basename === 'pytest') return 'test';
  if (basename === 'python' || basename === 'python3') {
    return arguments_[0] === '-m' && arguments_[1] === 'pytest' ? 'test' : null;
  }
  if (basename === 'node') return arguments_[0] === '--test' ? 'test' : null;
  if (basename === 'go') {
    return arguments_[0] === 'test' ? 'test' : arguments_[0] === 'build' ? 'build' : null;
  }
  if (basename === 'cargo') {
    return ['test', 'check', 'clippy'].includes(arguments_[0] ?? '')
      ? 'test'
      : arguments_[0] === 'build'
        ? 'build'
        : null;
  }
  if (basename === 'cmake') return arguments_[0] === '--build' ? 'build' : null;
  if (basename === 'make' || basename === 'ninja') return 'build';
  return null;
}

function classifyPythonExperiment(
  command: SshWorkspaceAgentCommand,
): SshWorkspaceOperationClass | null {
  if (command.command !== '/usr/bin/python' && command.command !== '/usr/bin/python3') return null;
  if (command.timeoutSeconds > SSH_COMMAND_MAX_TIMEOUT_SECONDS) return null;
  if (command.args.length > SSH_WORKSPACE_MAX_ARGUMENTS) return null;
  if (command.args.some((argument) => PYTHON_EXPERIMENT_SHELL_META_PATTERN.test(argument))) {
    return null;
  }

  const entrypointArguments = command.args[0] === '-u' ? command.args.slice(1) : command.args;
  if (
    entrypointArguments.length === 0 ||
    !PYTHON_EXPERIMENT_ENTRYPOINT_PATTERN.test(entrypointArguments[0]!)
  ) {
    return null;
  }
  const scriptArguments = entrypointArguments.slice(1);
  return scriptArguments.some((argument) => ['-', '-m', '--module'].includes(argument))
    ? null
    : 'experiment';
}

/**
 * An advisory command policy for a normal SSH account. It prevents raw-shell construction and
 * obvious host-wide paths, but executing project tests, builds, or experiments can run arbitrary
 * repository code.
 */
export function classifyWorkspaceCommand(
  command: SshWorkspaceAgentCommand,
  grant: RemoteWorkspaceGrant,
): SshWorkspaceOperationClass | null {
  const basename = executableBasename(command.command);
  if (!basename || FORBIDDEN_EXECUTABLES.has(basename)) return null;
  if (command.args.some((argument) => !argumentStaysInWorkspace(argument, grant.canonicalRoot))) {
    return null;
  }
  if (hasForbiddenInlineEvaluation(basename, command.args)) return null;
  if (basename === 'git') return classifyGit(command.args);
  if (grant.permissionMode !== 'workspace') return null;
  if (hasBlockedLauncherOption(basename, command.args)) return null;
  const experiment = classifyPythonExperiment(command);
  if (experiment) return experiment;
  return classifyTestOrBuild(basename, command.args);
}

/** Add fixed Git safety overrides before the exact command is shown for approval. */
export function hardenWorkspaceCommand(
  command: SshWorkspaceAgentCommand,
): SshWorkspaceAgentCommand {
  if (posix.basename(command.command) !== 'git') return command;
  const arguments_ = [...command.args];
  const globalOptions: string[] = [];
  while (
    ['--no-pager', '--literal-pathspecs', '--no-optional-locks'].includes(arguments_[0] ?? '')
  ) {
    globalOptions.push(arguments_.shift()!);
  }
  const [subcommand, ...rest] = arguments_;
  const diffSafety = ['diff', 'log', 'show'].includes(subcommand ?? '')
    ? ['--no-ext-diff', '--no-textconv']
    : [];
  return {
    ...command,
    args: [
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'core.pager=cat',
      '-c',
      'color.ui=false',
      ...globalOptions,
      subcommand!,
      ...diffSafety,
      ...rest,
    ],
  };
}
