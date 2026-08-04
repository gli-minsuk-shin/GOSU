import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GitCommandError, createGitCommandRunner } from '../src/main/git-command-runner';

describe('bounded Git command runner', () => {
  let directory: string;
  let executable: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'gosu-git-runner-'));
    executable = join(directory, 'fake-git');
    await writeFile(
      executable,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('trigger-xcrun')) {
  process.stderr.write('xcrun: error: active developer path is missing Command Line Tools');
  process.exit(1);
}
process.stdout.write(JSON.stringify({
  args,
  environment: {
    allowProtocol: process.env.GIT_ALLOW_PROTOCOL,
    configGlobal: process.env.GIT_CONFIG_GLOBAL,
    noSystem: process.env.GIT_CONFIG_NOSYSTEM,
    terminalPrompt: process.env.GIT_TERMINAL_PROMPT,
    askPass: process.env.GIT_ASKPASS,
    sshAskPass: process.env.SSH_ASKPASS,
    literalPathspecs: process.env.GIT_LITERAL_PATHSPECS,
    noReplaceObjects: process.env.GIT_NO_REPLACE_OBJECTS,
    attrNoSystem: process.env.GIT_ATTR_NOSYSTEM,
  },
}));
`,
      { mode: 0o700 },
    );
    await chmod(executable, 0o700);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('pins safe configuration and isolates user config for network operations', async () => {
    const previousAskPass = process.env.GIT_ASKPASS;
    const previousSshAskPass = process.env.SSH_ASKPASS;
    process.env.GIT_ASKPASS = '/private/untrusted-askpass';
    process.env.SSH_ASKPASS = '/private/untrusted-ssh-askpass';
    try {
      const output = await createGitCommandRunner(executable)(directory, ['fetch', 'origin'], {
        network: true,
      });
      const result = JSON.parse(output) as {
        args: string[];
        environment: Record<string, string | undefined>;
      };

      expect(result.args).toEqual(
        expect.arrayContaining([
          'core.hooksPath=/dev/null',
          '--no-replace-objects',
          '--literal-pathspecs',
          'core.fsmonitor=false',
          'core.askPass=/usr/bin/false',
          'submodule.recurse=false',
          'diff.external=',
          'protocol.allow=never',
          'protocol.https.allow=always',
          'credential.helper=',
          'fetch',
          'origin',
        ]),
      );
      expect(result.environment).toMatchObject({
        allowProtocol: 'https',
        configGlobal: '/dev/null',
        noSystem: '1',
        terminalPrompt: '0',
        askPass: '/usr/bin/false',
        sshAskPass: '/usr/bin/false',
        literalPathspecs: '1',
        noReplaceObjects: '1',
        attrNoSystem: '1',
      });
    } finally {
      if (previousAskPass === undefined) delete process.env.GIT_ASKPASS;
      else process.env.GIT_ASKPASS = previousAskPass;
      if (previousSshAskPass === undefined) delete process.env.SSH_ASKPASS;
      else process.env.SSH_ASKPASS = previousSshAskPass;
    }
  });

  it('isolates user configuration by default and opens it only for an explicit config read', async () => {
    const runner = createGitCommandRunner(executable);
    const isolated = JSON.parse(await runner(directory, ['status'])) as {
      environment: Record<string, string | undefined>;
    };
    expect(isolated.environment).toMatchObject({
      configGlobal: '/dev/null',
      noSystem: '1',
    });

    const identityRead = JSON.parse(
      await runner(directory, ['config', '--get', 'user.name'], { allowUserConfig: true }),
    ) as { environment: Record<string, string | undefined> };
    expect(identityRead.environment.configGlobal).toBeUndefined();
    expect(identityRead.environment.noSystem).toBeUndefined();
  });

  it('classifies a clean-Mac Command Line Tools failure as Git unavailable', async () => {
    await expect(createGitCommandRunner(executable)(directory, ['trigger-xcrun'])).rejects.toEqual(
      expect.objectContaining<Partial<GitCommandError>>({ kind: 'unavailable' }),
    );
  });
});
