import {
  Injectable,
  UnauthorizedException,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import { roleSchema, type Role } from './contracts.js';

export type Identity = { subject: string; issuer: string; role: Role; labId: string };
type Headers = Record<string, string | string[] | undefined>;

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function header(headers: Headers, name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function jwksForIssuer(issuer: string) {
  const normalizedIssuer = issuer.replace(/\/$/, '');
  const existing = jwksByIssuer.get(normalizedIssuer);
  if (existing) return existing;
  const jwks = createRemoteJWKSet(new URL(`${normalizedIssuer}/.well-known/jwks.json`));
  jwksByIssuer.set(normalizedIssuer, jwks);
  return jwks;
}

export async function authenticateHeaders(headers: Headers): Promise<Identity> {
  const mode = process.env.GOSU_AUTH_MODE ?? 'development';
  if (mode === 'development') {
    if (process.env.NODE_ENV === 'production') {
      throw new UnauthorizedException('development_auth_forbidden_in_production');
    }
    const role = roleSchema.safeParse(header(headers, 'x-gosu-role'));
    const subject = header(headers, 'x-gosu-sub');
    const labId = header(headers, 'x-gosu-lab');
    if (!role.success || !subject || !labId) {
      throw new UnauthorizedException('invalid_development_identity');
    }
    return { subject, issuer: 'gosu:development', role: role.data, labId };
  }

  if (mode !== 'oidc') throw new UnauthorizedException('unsupported_auth_mode');
  const issuer = process.env.GOSU_OIDC_ISSUER;
  const audience = process.env.GOSU_OIDC_AUDIENCE;
  const token = header(headers, 'authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!issuer || !audience || !token) {
    throw new UnauthorizedException('oidc_configuration_or_token_missing');
  }

  try {
    const jwks = jwksForIssuer(issuer);
    const verified = await jwtVerify(token, jwks, { issuer, audience });
    const role = roleSchema.parse(verified.payload['gosu:role']);
    const labId = verified.payload['gosu:lab'];
    if (
      !verified.payload.sub ||
      !verified.payload.iss ||
      typeof verified.payload.exp !== 'number' ||
      typeof labId !== 'string' ||
      !labId
    ) {
      throw new Error('membership_claims_missing');
    }
    return { subject: verified.payload.sub, issuer: verified.payload.iss, role, labId };
  } catch {
    throw new UnauthorizedException('invalid_bearer_token');
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    identity?: Identity;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.url === '/health' || request.url.startsWith('/health?')) return true;
    request.identity = await authenticateHeaders(request.headers);
    return true;
  }
}

export const CurrentIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<FastifyRequest>().identity as Identity,
);
