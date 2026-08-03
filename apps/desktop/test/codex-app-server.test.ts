import { describe, expect, it } from 'vitest';

import { buildCodexChildEnvironment } from '../src/main/codex-app-server';

describe('Codex App Server process boundary', () => {
  it('passes only runtime, temporary-file, certificate, and proxy settings', () => {
    const environment = buildCodexChildEnvironment(
      {
        PATH: '/usr/bin',
        HOME: '/Users/researcher',
        TMPDIR: '/tmp/gosu',
        SSL_CERT_FILE: '/etc/certs.pem',
        HTTPS_PROXY: 'http://proxy.test',
        NO_PROXY: '127.0.0.1',
        GOSU_OIDC_CLIENT_SECRET: 'do-not-pass',
        OPENAI_API_KEY: 'do-not-pass',
        GITHUB_TOKEN: 'do-not-pass',
        DATABASE_URL: 'do-not-pass',
        CODEX_HOME: '/custom/codex',
      },
      true,
      'info',
    );

    expect(environment).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/researcher',
      TMPDIR: '/tmp/gosu',
      SSL_CERT_FILE: '/etc/certs.pem',
      HTTPS_PROXY: 'http://proxy.test',
      NO_PROXY: '127.0.0.1',
      RUST_LOG: 'info',
      ELECTRON_RUN_AS_NODE: '1',
    });
  });

  it('does not accept arbitrary Rust log directives from the parent environment', () => {
    expect(buildCodexChildEnvironment({}, false, 'trace,secret_module=debug')).toEqual({
      RUST_LOG: 'warn',
    });
  });
});
