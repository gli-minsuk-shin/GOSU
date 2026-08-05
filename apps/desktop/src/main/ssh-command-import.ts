import { isIP } from 'node:net';

import {
  SSH_CONNECTION_LABEL_MAX_LENGTH,
  SSH_HOST_ALIAS_MAX_LENGTH,
  SSH_IMPORT_COMMAND_MAX_LENGTH,
  SSH_MAX_LOCAL_FORWARDINGS,
  SshDirectTargetSchema,
  type SshDirectTarget,
} from '../shared/ssh-contracts';

export class SshCommandImportError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'SshCommandImportError';
  }
}

const USER_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/u;
const HOST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/u;
const SHELL_OR_QUOTING_SYNTAX = /['"`\\;$|&<>(){}*?!]/u;

function invalid(reason: string): never {
  throw new SshCommandImportError(reason);
}

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function parsePort(value: string, minimum = 1) {
  if (!/^[0-9]{1,5}$/u.test(value)) invalid('invalid_port');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < minimum || port > 65_535) invalid('invalid_port');
  return port;
}

function normalizeBracketedHost(value: string) {
  const host = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  if ((isIP(host) === 0 && !HOST_PATTERN.test(host)) || host.includes('..'))
    invalid('invalid_host');
  return host;
}

function parseDestination(value: string) {
  const firstAt = value.indexOf('@');
  const lastAt = value.lastIndexOf('@');
  if (firstAt !== lastAt) invalid('invalid_destination');
  if (firstAt < 0) return { host: normalizeBracketedHost(value) };
  const user = value.slice(0, firstAt);
  const host = value.slice(firstAt + 1);
  if (!USER_PATTERN.test(user)) invalid('invalid_user');
  return { user, host: normalizeBracketedHost(host) };
}

function splitForward(value: string) {
  const parts: string[] = [];
  let buffer = '';
  let bracketDepth = 0;
  for (const character of value) {
    if (character === '[') bracketDepth += 1;
    if (character === ']') bracketDepth -= 1;
    if (bracketDepth < 0) invalid('invalid_local_forward');
    if (character === ':' && bracketDepth === 0) {
      parts.push(buffer);
      buffer = '';
    } else {
      buffer += character;
    }
  }
  if (bracketDepth !== 0) invalid('invalid_local_forward');
  parts.push(buffer);
  return parts;
}

function normalizeLoopback(value: string) {
  const host = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    invalid('local_forward_must_use_loopback');
  }
  return host;
}

function parseLocalForward(value: string) {
  const parts = splitForward(value);
  const [bindAddress, localPort, destinationHost, destinationPort] =
    parts.length === 3
      ? ['127.0.0.1', parts[0], parts[1], parts[2]]
      : parts.length === 4
        ? parts
        : invalid('invalid_local_forward');
  return {
    bindAddress: normalizeLoopback(bindAddress!),
    localPort: parsePort(localPort!, 1_024),
    destinationHost: normalizeLoopback(destinationHost!),
    destinationPort: parsePort(destinationPort!),
  };
}

function optionValue(tokens: readonly string[], index: number, option: '-p' | '-l' | '-L') {
  const token = tokens[index]!;
  if (token === option) {
    const value = tokens[index + 1];
    if (!value || value.startsWith('-')) invalid('missing_option_value');
    return { value, consumed: 2 };
  }
  return { value: token.slice(option.length), consumed: 1 };
}

function defaultLabel() {
  return 'Imported SSH server'.slice(0, SSH_CONNECTION_LABEL_MAX_LENGTH);
}

export function directTargetAlias(target: SshDirectTarget) {
  const safeHost = target.host.replaceAll(/[^A-Za-z0-9._-]/gu, '-').replaceAll(/-+/gu, '-');
  return `direct-${safeHost}${target.port ? `-${target.port}` : ''}`.slice(
    0,
    SSH_HOST_ALIAS_MAX_LENGTH,
  );
}

/** Parse a narrow OpenSSH connection command without a shell, expansion, or config mutation. */
export function parseSshConnectionCommand(command: string) {
  const trimmed = command.trim();
  if (!trimmed || trimmed.length > SSH_IMPORT_COMMAND_MAX_LENGTH) invalid('invalid_command_length');
  if (hasControlCharacter(trimmed)) invalid('control_character');
  if (SHELL_OR_QUOTING_SYNTAX.test(trimmed)) invalid('shell_syntax_not_allowed');

  const tokens = trimmed.split(/[ \t]+/u);
  const executable = tokens.shift();
  if (executable !== 'ssh' && executable !== '/usr/bin/ssh') invalid('unsupported_executable');
  if (tokens.length === 0) invalid('missing_destination');

  let destination: ReturnType<typeof parseDestination> | undefined;
  let port: number | undefined;
  let optionUser: string | undefined;
  const localForwards: ReturnType<typeof parseLocalForward>[] = [];
  let optionBoundarySeen = false;

  for (let index = 0; index < tokens.length;) {
    const token = tokens[index]!;
    if (token === '--') {
      if (optionBoundarySeen || destination) invalid('invalid_option_boundary');
      optionBoundarySeen = true;
      index += 1;
      continue;
    }
    if (!optionBoundarySeen && (token === '-p' || token.startsWith('-p'))) {
      if (port !== undefined) invalid('duplicate_port');
      const parsed = optionValue(tokens, index, '-p');
      port = parsePort(parsed.value);
      index += parsed.consumed;
      continue;
    }
    if (!optionBoundarySeen && (token === '-l' || token.startsWith('-l'))) {
      if (optionUser !== undefined) invalid('duplicate_user');
      const parsed = optionValue(tokens, index, '-l');
      if (!USER_PATTERN.test(parsed.value)) invalid('invalid_user');
      optionUser = parsed.value;
      index += parsed.consumed;
      continue;
    }
    if (!optionBoundarySeen && (token === '-L' || token.startsWith('-L'))) {
      if (localForwards.length >= SSH_MAX_LOCAL_FORWARDINGS) invalid('too_many_local_forwards');
      const parsed = optionValue(tokens, index, '-L');
      const forward = parseLocalForward(parsed.value);
      if (localForwards.some((candidate) => candidate.localPort === forward.localPort)) {
        invalid('duplicate_local_port');
      }
      localForwards.push(forward);
      index += parsed.consumed;
      continue;
    }
    if (token.startsWith('-')) invalid('unsupported_option');
    if (destination) invalid('remote_command_not_allowed');
    destination = parseDestination(token);
    index += 1;
  }

  if (!destination) invalid('missing_destination');
  if (destination.user && optionUser && destination.user !== optionUser)
    invalid('conflicting_user');
  const target = SshDirectTargetSchema.parse({
    host: destination.host,
    ...(destination.user || optionUser ? { user: destination.user ?? optionUser } : {}),
    ...(port === undefined ? {} : { port }),
    localForwards: localForwards.sort(
      (left, right) =>
        left.localPort - right.localPort ||
        left.bindAddress.localeCompare(right.bindAddress) ||
        left.destinationPort - right.destinationPort,
    ),
  });
  return {
    target,
    hostAlias: directTargetAlias(target),
    defaultLabel: defaultLabel(),
  } as const;
}
