/**
 * Structured logging.
 *
 * Field names follow docs/07: request_id, tool_name, provider, duration_ms,
 * success, error_code. Secrets are redacted by the logger itself rather than
 * by each call site, because a call site that forgets is how credentials end
 * up in CloudWatch.
 */

import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

import type { AppConfig } from '@/config';

/** Key names whose values must never reach a log line. */
const SECRET_KEYS = [
  'authorization',
  'Authorization',
  'token',
  'access_token',
  'client_secret',
  'admin_secret',
  'hasura_admin_secret',
  'password',
  'connection_string',
] as const;

/**
 * Each secret key is redacted at the top level and one level deep. Derived
 * rather than written out, so adding a key cannot accidentally cover only one
 * of the two positions. Matching values are replaced wholesale — we never log
 * a partial secret.
 */
export const REDACTED_PATHS: readonly string[] = SECRET_KEYS.flatMap((key) => [
  key,
  `*.${key}`,
]);

export type LogContext = {
  readonly request_id: string;
  readonly tool_name?: string;
  readonly workspace_id?: string;
};

export function createLogger(
  config: Pick<AppConfig, 'logLevel' | 'nodeEnv' | 'provider'>,
  destination?: DestinationStream,
): Logger {
  const options: LoggerOptions = {
    level: config.logLevel,
    base: { provider: config.provider, env: config.nodeEnv },
    redact: {
      paths: [...REDACTED_PATHS],
      censor: '[redacted]',
    },
  };

  return destination === undefined ? pino(options) : pino(options, destination);
}

/**
 * A request-scoped child logger. Every line emitted while handling one MCP
 * request carries the same correlation id, so a single call can be followed
 * from transport through domain service to provider.
 */
export function forRequest(logger: Logger, context: LogContext): Logger {
  return logger.child({ ...context });
}
