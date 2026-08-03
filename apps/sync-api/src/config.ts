export type SyncApiConfig = Readonly<{
  environment: 'development' | 'test' | 'production';
  host: string;
  port: number;
  allowedOrigins: readonly string[];
  authMode: 'development' | 'oidc';
  persistence: 'memory';
}>;

type Environment = Readonly<Record<string, string | undefined>>;

export class SyncApiConfigurationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SyncApiConfigurationError';
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const DEFAULT_ORIGINS = ['http://127.0.0.1:3000', 'http://localhost:3000'] as const;

export function loadSyncApiConfig(environment: Environment = process.env): SyncApiConfig {
  const nodeEnvironment = environment.NODE_ENV?.trim() || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnvironment)) {
    throw new SyncApiConfigurationError('invalid_node_environment');
  }
  const runtimeEnvironment = nodeEnvironment as SyncApiConfig['environment'];

  const host = environment.GOSU_SYNC_API_HOST?.trim() || '127.0.0.1';
  const port = parsePort(environment.GOSU_SYNC_API_PORT);
  const authMode = environment.GOSU_AUTH_MODE?.trim() || 'development';
  if (authMode !== 'development' && authMode !== 'oidc') {
    throw new SyncApiConfigurationError('invalid_auth_mode');
  }

  const persistence = environment.GOSU_PERSISTENCE?.trim() || 'memory';
  if (persistence !== 'memory') {
    // The PostgreSQL adapter is intentionally not a runnable application backend yet.
    throw new SyncApiConfigurationError('persistence_adapter_not_available');
  }

  if (runtimeEnvironment === 'production') {
    const explicitlyConfigured = [
      environment.GOSU_SYNC_API_HOST,
      environment.GOSU_SYNC_API_PORT,
      environment.GOSU_ALLOWED_ORIGINS,
      environment.GOSU_AUTH_MODE,
    ].every((value) => value !== undefined && value.trim().length > 0);
    if (!explicitlyConfigured) {
      throw new SyncApiConfigurationError('production_configuration_incomplete');
    }
    if (authMode !== 'oidc') {
      throw new SyncApiConfigurationError('production_requires_oidc');
    }
  }

  const allowedOrigins = parseOrigins(environment.GOSU_ALLOWED_ORIGINS, runtimeEnvironment);

  if (authMode === 'development' && !LOOPBACK_HOSTS.has(host)) {
    throw new SyncApiConfigurationError('development_auth_requires_loopback');
  }

  if (authMode === 'oidc') validateOidcConfiguration(environment, runtimeEnvironment);

  if (runtimeEnvironment === 'production') {
    // Running the hosted service on the development in-memory store would lose collaboration
    // state and falsely report readiness. Production remains unavailable until its repository
    // adapter is wired and recovery-tested.
    throw new SyncApiConfigurationError('production_persistence_not_available');
  }

  return {
    environment: runtimeEnvironment,
    host,
    port,
    allowedOrigins,
    authMode,
    persistence,
  };
}

function parsePort(rawPort: string | undefined) {
  if (rawPort === undefined || rawPort.trim() === '') return 4000;
  if (!/^\d+$/.test(rawPort.trim())) {
    throw new SyncApiConfigurationError('invalid_sync_api_port');
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new SyncApiConfigurationError('invalid_sync_api_port');
  }
  return port;
}

function parseOrigins(rawOrigins: string | undefined, environment: SyncApiConfig['environment']) {
  const values = rawOrigins === undefined ? DEFAULT_ORIGINS : rawOrigins.split(',');
  const origins = values.map((value) => {
    const candidate = value.trim().replace(/\/$/, '');
    if (!candidate || candidate === '*') {
      throw new SyncApiConfigurationError('invalid_allowed_origin');
    }
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new SyncApiConfigurationError('invalid_allowed_origin');
    }
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.origin !== candidate ||
      url.username !== '' ||
      url.password !== ''
    ) {
      throw new SyncApiConfigurationError('invalid_allowed_origin');
    }
    if (environment === 'production' && url.protocol !== 'https:') {
      throw new SyncApiConfigurationError('production_requires_https_origins');
    }
    return url.origin;
  });
  if (origins.length === 0) throw new SyncApiConfigurationError('allowed_origins_required');
  return [...new Set(origins)];
}

function validateOidcConfiguration(
  environment: Environment,
  runtimeEnvironment: SyncApiConfig['environment'],
) {
  const issuer = environment.GOSU_OIDC_ISSUER?.trim();
  const audience = environment.GOSU_OIDC_AUDIENCE?.trim();
  if (!issuer || !audience) {
    throw new SyncApiConfigurationError('oidc_configuration_incomplete');
  }
  let issuerUrl: URL;
  try {
    issuerUrl = new URL(issuer);
  } catch {
    throw new SyncApiConfigurationError('invalid_oidc_issuer');
  }
  if (
    (issuerUrl.protocol !== 'http:' && issuerUrl.protocol !== 'https:') ||
    issuerUrl.username !== '' ||
    issuerUrl.password !== '' ||
    issuerUrl.search !== '' ||
    issuerUrl.hash !== '' ||
    (runtimeEnvironment === 'production' && issuerUrl.protocol !== 'https:')
  ) {
    throw new SyncApiConfigurationError('invalid_oidc_issuer');
  }
}
