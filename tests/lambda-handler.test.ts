/**
 * The Lambda entry point, exercised as API Gateway would.
 *
 * A synthetic HTTP API v2 event goes in and a real MCP response comes out,
 * with a genuinely signed token. This is the only place where authentication,
 * the transport and the provider meet, so it is the only place their
 * interaction can be wrong.
 *
 * No AWS, no network: the JWKS is served from a locally generated key, and the
 * provider is the in-memory one.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';

import { createTokenVerifier } from '@/auth/verify';
import { createHandler, type McpHandler, type Runtime } from '@/lambda/handler';
import { InMemoryLumanuProvider } from '@/providers';

import { silentLogger } from './support/silent-logger';

const AUTH0_DOMAIN = 'tenant.us.auth0.com';
const AUDIENCE = 'https://lumanu-mcp-poc/api';

let signValidToken: (overrides?: { audience?: string; expiresIn?: string }) => Promise<string>;
let handler: McpHandler;

/**
 * The verifier is given the keys directly rather than left to fetch them.
 *
 * jose's Node build resolves a remote JWKS over `https` rather than
 * `globalThis.fetch`, so stubbing fetch does not intercept it — the first
 * attempt at this test hit real DNS, failed every valid-token case with a 401,
 * and left the handle open that stopped Jest exiting. Supplying the runtime is
 * both simpler and a truer test: the signature check is entirely real.
 */
beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

  signValidToken = (overrides = {}) =>
    new SignJWT({ sub: 'reviewer@clients', scope: 'read:workspaces' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuedAt()
      .setIssuer(`https://${AUTH0_DOMAIN}/`)
      .setAudience(overrides.audience ?? AUDIENCE)
      .setExpirationTime(overrides.expiresIn ?? '5m')
      .sign(privateKey);

  const runtime: Runtime = {
    config: { provider: 'mock', nodeEnv: 'test', logLevel: 'silent' },
    logger: silentLogger(),
    provider: new InMemoryLumanuProvider(),
    verifyToken: createTokenVerifier({
      issuer: `https://${AUTH0_DOMAIN}/`,
      audience: AUDIENCE,
      keys: () => Promise.resolve({ keys: [jwk] }),
    }),
  };

  handler = createHandler(() => Promise.resolve(runtime));
});

function event(body: unknown, authorization?: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /mcp',
    rawPath: '/mcp',
    rawQueryString: '',
    headers: {
      'content-type': 'application/json',
      ...(authorization === undefined ? {} : { Authorization: authorization }),
    },
    requestContext: {
      requestId: 'apigw-request-1',
      domainName: 'abc123.execute-api.us-east-1.amazonaws.com',
      http: { method: 'POST', path: '/mcp', protocol: 'HTTP/1.1', sourceIp: '1.2.3.4', userAgent: 'jest' },
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.0' },
  },
};

function bodyOf(result: unknown): Record<string, unknown> {
  const { body } = result as { body: string };
  return JSON.parse(body) as Record<string, unknown>;
}

function statusOf(result: unknown): number {
  return (result as { statusCode: number }).statusCode;
}

describe('a request without a usable token', () => {
  it('is rejected when the Authorization header is missing', async () => {
    const result = await handler(event(initialize));

    expect(statusOf(result)).toBe(401);
  });

  it('tells the client to send a bearer token', async () => {
    const result = await handler(event(initialize));
    const headers = (result as { headers: Record<string, string> }).headers;

    expect(headers['www-authenticate']).toBe('Bearer');
  });

  it('is rejected when the token has expired', async () => {
    const expired = await signValidToken({ expiresIn: '-1m' });

    expect(statusOf(await handler(event(initialize, `Bearer ${expired}`)))).toBe(401);
  });

  it('is rejected when the token was issued for another audience', async () => {
    const wrong = await signValidToken({ audience: 'https://somewhere-else/api' });

    expect(statusOf(await handler(event(initialize, `Bearer ${wrong}`)))).toBe(401);
  });

  it('answers in JSON-RPC, so an MCP client can read the refusal', async () => {
    const body = bodyOf(await handler(event(initialize)));

    expect(body['jsonrpc']).toBe('2.0');
    expect(body['error']).toMatchObject({ code: -32001 });
  });

  it('does not leak the token back in the response', async () => {
    const expired = await signValidToken({ expiresIn: '-1m' });
    const result = await handler(event(initialize, `Bearer ${expired}`));

    expect((result as { body: string }).body).not.toContain(expired.slice(0, 40));
  });
});

describe('a request with a valid token', () => {
  it('completes the MCP handshake', async () => {
    const token = await signValidToken();

    const result = await handler(event(initialize, `Bearer ${token}`));

    expect(statusOf(result)).toBe(200);
    const body = bodyOf(result);
    expect((body['result'] as { serverInfo: { name: string } }).serverInfo.name).toBe(
      'lumanu-mcp-poc',
    );
  });

  it('carries the API Gateway request id back, so a log line can be found', async () => {
    const token = await signValidToken();
    const result = await handler(event(initialize, `Bearer ${token}`));

    expect((result as { headers: Record<string, string> }).headers['x-request-id']).toBe(
      'apigw-request-1',
    );
  });

  it('accepts the header whatever its casing', async () => {
    const token = await signValidToken();
    const lowercase = event(initialize);
    lowercase.headers['authorization'] = `Bearer ${token}`;

    expect(statusOf(await handler(lowercase))).toBe(200);
  });

  it('creates no session, because the transport is stateless', async () => {
    const token = await signValidToken();
    const result = await handler(event(initialize, `Bearer ${token}`));
    const headers = (result as { headers: Record<string, string> }).headers;

    expect(headers['mcp-session-id']).toBeUndefined();
  });

  it('serves a second request without any state from the first', async () => {
    const token = await signValidToken();

    const first = await handler(event(initialize, `Bearer ${token}`));
    const second = await handler(event(initialize, `Bearer ${token}`));

    expect(statusOf(first)).toBe(200);
    expect(statusOf(second)).toBe(200);
  });
});
