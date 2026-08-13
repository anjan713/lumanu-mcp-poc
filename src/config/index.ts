/**
 * Runtime configuration, parsed once from the environment.
 *
 * Deployed configuration arrives as environment variables populated from AWS
 * Secrets Manager; locally it comes from a gitignored `.env`. Either way the
 * shape is the same, and nothing downstream reads `process.env` directly.
 */

export const PROVIDER_KINDS = ['mock', 'real'] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export class ConfigError extends Error {
  public override readonly name = 'ConfigError';
}

export interface AppConfig {
  /** Which LumanuProvider implementation to construct. See ADR 0001. */
  readonly provider: ProviderKind;
  readonly nodeEnv: string;
  readonly logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    provider: parseProvider(env['LUMANU_PROVIDER']),
    nodeEnv: env['NODE_ENV'] ?? 'development',
    logLevel: env['LOG_LEVEL'] ?? 'info',
  };
}

/**
 * An unrecognised value throws rather than falling back to `mock`. A silent
 * fallback would be a genuine hazard once RealLumanuProvider is wired: a typo
 * in the deployed environment would quietly serve mock data from what looks
 * like a production endpoint.
 */
function parseProvider(raw: string | undefined): ProviderKind {
  if (raw === undefined || raw === '') {
    return 'mock';
  }

  const match = PROVIDER_KINDS.find((kind) => kind === raw);
  if (match === undefined) {
    throw new ConfigError(
      `LUMANU_PROVIDER must be one of: ${PROVIDER_KINDS.join(', ')} — received "${raw}"`,
    );
  }

  return match;
}
