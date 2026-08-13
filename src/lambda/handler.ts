/**
 * The Lambda entry point: API Gateway HTTP API → MCP.
 *
 * Stateless Streamable HTTP. Every request is independent — no session
 * identifier, no long-lived event stream, no resumability — so any container
 * can serve any request and nothing has to be sticky. API Gateway supports
 * response streaming now, so this is a deliberate choice rather than a
 * constraint: every tool here is request/response.
 *
 * The transport speaks web-standard `Request`/`Response`, which is exactly
 * what an API Gateway v2 event converts to, so no Node `http` shim is needed.
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';

import { AuthError, createTokenVerifier, type TokenVerifier } from '@/auth/verify';
import { loadConfig, type AppConfig } from '@/config';
import { loadSecrets } from '@/config/secrets';
import { buildMcpServer } from '@/mcp/server';
import { createLogger, forRequest } from '@/observability/logger';
import { createProvider, type LumanuProvider } from '@/providers';

/**
 * Built once per container and reused while it stays warm. The provider holds
 * a connection pool worth keeping; the MCP server does not, and is rebuilt per
 * request so nothing leaks between callers.
 */
export interface Runtime {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly provider: LumanuProvider;
  readonly verifyToken: TokenVerifier;
}

let runtime: Runtime | undefined;

/**
 * Builds the runtime from the environment. Called once per container; the
 * result is reused while the container stays warm.
 */
export async function buildRuntime(): Promise<Runtime> {
  // Reads SSM only when SSM_PARAMETER_PATH is set, and only on a cold start.
  await loadSecrets();

  const config = loadConfig();
  const issuer = `https://${required('AUTH0_DOMAIN')}/`;

  return {
    config,
    logger: createLogger(config),
    provider: createProvider(config),
    verifyToken: createTokenVerifier({ issuer, audience: required('AUTH0_AUDIENCE') }),
  };
}

async function getRuntime(): Promise<Runtime> {
  runtime ??= await buildRuntime();
  return runtime;
}

function required(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(`${key} is required and is not set.`);
  }
  return value;
}

function jsonRpcError(status: number, message: string, requestId: string): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: {
      'content-type': 'application/json',
      // Told to the client so it knows to obtain a token, per RFC 6750.
      ...(status === 401 ? { 'www-authenticate': 'Bearer' } : {}),
      'x-request-id': requestId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      error: { code: status === 401 ? -32001 : -32603, message },
      id: null,
    }),
  };
}

export type McpHandler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;

/**
 * The handler, over a runtime supplied by the caller.
 *
 * Exported separately from `handler` so tests can supply an in-memory provider
 * and a locally-keyed verifier. That is a real seam rather than a testing
 * concession: it is the same substitution the provider abstraction makes
 * everywhere else, applied one layer higher.
 */
export function createHandler(load: () => Promise<Runtime>): McpHandler {
  return async (event) => handleWith(await load(), event);
}

export const handler: McpHandler = (event) => handleWith(undefined, event);

async function handleWith(
  supplied: Runtime | undefined,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  // API Gateway's request id, so a CloudWatch line can be traced back to an
  // access log entry. Falls back to a fresh one when invoked directly.
  const requestId = event.requestContext?.requestId ?? randomUUID();
  const started = Date.now();

  let log: Logger | undefined;
  try {
    const { logger, provider, verifyToken, config } = supplied ?? (await getRuntime());
    log = forRequest(logger, { request_id: requestId });

    const authorization = headerOf(event, 'authorization');
    const caller = await verifyToken(authorization);
    log = forRequest(logger, { request_id: requestId, subject: caller.subject });

    const server = buildMcpServer({ provider, logger: log });
    // Omitting sessionIdGenerator entirely — rather than passing undefined —
    // is what puts the transport in stateless mode: no session is created and
    // no session header is required of the client.
    const transport = new WebStandardStreamableHTTPServerTransport({
      // Answer with a single JSON body rather than an SSE stream. Every tool
      // here is request/response, and JSON is what API Gateway buffers best.
      enableJsonResponse: true,
    });

    let response: Response;
    let body: string;
    try {
      await server.connect(transport);
      response = await transport.handleRequest(toRequest(event));
      body = await response.text();
    } finally {
      // A server is built per request, so it must be closed per request.
      // Without this every invocation leaves a connected transport behind —
      // which keeps the Node process alive locally, and in a warm Lambda
      // container accumulates one leaked server per request served.
      await server.close().catch(() => undefined);
    }

    log.info(
      {
        duration_ms: Date.now() - started,
        success: response.ok,
        status: response.status,
        provider: config.provider,
      },
      'mcp request completed',
    );

    return {
      statusCode: response.status,
      headers: { ...Object.fromEntries(response.headers), 'x-request-id': requestId },
      body,
    };
  } catch (error) {
    if (error instanceof AuthError) {
      log?.warn({ duration_ms: Date.now() - started, success: false, error_code: 'AuthError' },
        'request rejected');
      return jsonRpcError(401, error.message, requestId);
    }

    // Deliberately not echoed to the caller: a configuration failure names
    // internal detail, and the client can do nothing with it. It is logged.
    log?.error(
      {
        duration_ms: Date.now() - started,
        success: false,
        error_code: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
      },
      'request failed',
    );
    return jsonRpcError(500, 'Internal error. See server logs for the request id above.', requestId);
  }
}

/** Header lookup that does not depend on API Gateway's casing. */
function headerOf(event: APIGatewayProxyEventV2, name: string): string | undefined {
  const headers = event.headers ?? {};
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name);
  return match === undefined ? undefined : headers[match];
}

function toRequest(event: APIGatewayProxyEventV2): Request {
  const { domainName = 'localhost', http } = event.requestContext ?? {};
  const path = http?.path ?? event.rawPath ?? '/mcp';
  const query = event.rawQueryString === undefined || event.rawQueryString === '' ? '' : `?${event.rawQueryString}`;

  const body =
    event.body === undefined
      ? undefined
      : event.isBase64Encoded === true
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;

  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers.set(key, value);
  }
  // The transport requires the client to accept both, and some clients send
  // only one. Broadening it here keeps the transport strict without making
  // the deployment fussy.
  headers.set('accept', 'application/json, text/event-stream');

  const method = http?.method ?? 'POST';

  // Always https: API Gateway terminates TLS, and the URL is only used by
  // the transport to read the path.
  return new Request(`https://${domainName}${path}${query}`, {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD' || body === undefined ? {} : { body }),
  });
}
