import { describe, expect, it } from 'vitest';

import { SshCommandImportError, parseSshConnectionCommand } from '../src/main/ssh-command-import';

describe('safe SSH connection command import', () => {
  it('normalizes the requested example without executing or retaining its raw command', () => {
    const parsed = parseSshConnectionCommand(
      'ssh -p 2222 researcher@203.0.113.10 -L 8080:localhost:8080',
    );

    expect(parsed).toEqual({
      defaultLabel: 'Imported SSH server',
      hostAlias: 'direct-203.0.113.10-2222',
      target: {
        host: '203.0.113.10',
        user: 'researcher',
        port: 2222,
        localForwards: [
          {
            bindAddress: '127.0.0.1',
            localPort: 8080,
            destinationHost: 'localhost',
            destinationPort: 8080,
          },
        ],
      },
    });
    expect(JSON.stringify(parsed)).not.toContain('ssh -p');
  });

  it('accepts safe option order, compact forms, an option boundary, and bracketed loopback', () => {
    expect(
      parseSshConnectionCommand(
        '/usr/bin/ssh -L[::1]:9000:[::1]:9001 -lresearcher -p2222 -- gpu.example.edu',
      ).target,
    ).toEqual({
      host: 'gpu.example.edu',
      user: 'researcher',
      port: 2222,
      localForwards: [
        {
          bindAddress: '::1',
          localPort: 9000,
          destinationHost: '::1',
          destinationPort: 9001,
        },
      ],
    });
  });

  it('normalizes a bracketed IPv6 destination while retaining unambiguous display text', () => {
    expect(parseSshConnectionCommand('ssh -p 2222 researcher@[2001:db8::10]')).toMatchObject({
      defaultLabel: 'Imported SSH server',
      target: { host: '2001:db8::10', user: 'researcher', port: 2222 },
    });
  });

  it('canonicalizes forwarding order and rejects a duplicate local listener', () => {
    const parsed = parseSshConnectionCommand(
      'ssh -L 9001:localhost:81 host.example -L 9000:127.0.0.1:80',
    );
    expect(parsed.target.localForwards.map((forward) => forward.localPort)).toEqual([9000, 9001]);
    expect(() =>
      parseSshConnectionCommand('ssh -L 9000:localhost:80 host.example -L 9000:localhost:81'),
    ).toThrow(
      expect.objectContaining<Partial<SshCommandImportError>>({ reason: 'duplicate_local_port' }),
    );
  });

  it.each([
    'bash -c ssh host.example',
    'env ssh host.example',
    'ＳＳＨ host.example',
    'ssh -o ProxyCommand=evil host.example',
    'ssh -F /tmp/config host.example',
    'ssh -i ~/.ssh/id_ed25519 host.example',
    'ssh -J jump.example host.example',
    'ssh -R 9000:localhost:9000 host.example',
    'ssh -D 1080 host.example',
    'ssh -A host.example',
    'ssh -t host.example',
    'ssh host.example uname -a',
    'ssh host.example; touch /tmp/unsafe',
    'ssh "host.example"',
    'ssh host\\.example',
    'ssh host.example\nwhoami',
    'ssh -p 0 host.example',
    'ssh -p 65536 host.example',
    'ssh -p 22 -p 23 host.example',
    'ssh -l one two@host.example',
    'ssh user@other@host.example',
    'ssh -L 80:localhost:80 host.example',
    'ssh -L 0.0.0.0:8080:localhost:8080 host.example',
    'ssh -L *:8080:localhost:8080 host.example',
    'ssh -L 8080:database.internal:5432 host.example',
    'ssh -L 8080:localhost:8080',
  ])('rejects unsupported or ambiguous input: %s', (command) => {
    expect(() => parseSshConnectionCommand(command)).toThrow(SshCommandImportError);
  });
});
