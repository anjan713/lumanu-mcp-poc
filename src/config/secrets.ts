/**
 * Reading runtime secrets from AWS.
 *
 * Secrets live as SSM Parameter Store `SecureString` parameters under one
 * path, KMS-encrypted at rest and read by the Lambda's execution role. Nothing
 * is committed, and nothing above `loadConfig` knows where the values came
 * from — locally they arrive from a gitignored `.env`, in AWS from here, and
 * the shape is identical either way.
 *
 * Parameter Store rather than Secrets Manager because it does the same job
 * here for nothing, where Secrets Manager would have been the entire AWS bill
 * for this project. See ADR 0003.
 */

import { GetParametersByPathCommand, SSMClient } from '@aws-sdk/client-ssm';

export class SecretsError extends Error {
  public override readonly name = 'SecretsError';
}

/**
 * The narrow thing this module needs from AWS. Named as a port so the merging
 * and caching rules can be tested without an AWS account, a network, or a
 * mocked SDK — the parts most likely to be wrong are the parts that have
 * nothing to do with AWS.
 */
export interface ParameterReader {
  /** Every parameter under `path`, decrypted, keyed by full parameter name. */
  byPath(path: string): Promise<Record<string, string>>;
}

/** Fetched values, kept for the life of the Lambda container. */
export type ParameterCache = Record<string, Record<string, string>>;

export interface LoadOptions {
  /** Undefined outside AWS, where `.env` supplies the values instead. */
  readonly path: string | undefined;
  readonly cache?: ParameterCache;
}

const VARIABLE_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * `/lumanu-mcp-poc/prod/HASURA_ADMIN_SECRET` becomes `HASURA_ADMIN_SECRET`.
 *
 * The last path segment *is* the variable name, deliberately, so that the
 * parameter path and `.env.example` read as the same list and neither needs a
 * translation table to keep in step with the other.
 */
export function parametersToEnvironment(
  parameters: Record<string, string>,
): Record<string, string> {
  const environment: Record<string, string> = {};

  for (const [name, value] of Object.entries(parameters)) {
    const segments = name.split('/').filter((segment) => segment.length > 0);
    const key = segments[segments.length - 1] ?? '';

    if (!VARIABLE_NAME.test(key)) {
      throw new SecretsError(
        `The parameter "${name}" does not end in a usable environment variable name. ` +
          'Parameters must be named after the variable they supply, in UPPER_SNAKE_CASE.',
      );
    }
    environment[key] = value;
  }

  return environment;
}

/**
 * Fills `environment` from the parameters under `options.path`.
 *
 * Existing values win. One already set was set on purpose — by `.env` locally,
 * or by a Lambda environment variable overriding for one deployment — and
 * having AWS silently overwrite it would make those overrides useless in a way
 * that is very hard to see.
 */
export async function loadParametersInto(
  environment: NodeJS.ProcessEnv,
  reader: ParameterReader,
  options: LoadOptions,
): Promise<void> {
  const { path } = options;
  if (path === undefined || path === '') return;

  const cache = options.cache;
  let parameters = cache?.[path];

  if (parameters === undefined) {
    parameters = await reader.byPath(path);
    if (cache !== undefined) cache[path] = parameters;
  }

  if (Object.keys(parameters).length === 0) {
    throw new SecretsError(
      `No parameters found under "${path}". Check the path and that the execution role is ` +
        'allowed ssm:GetParametersByPath on it.',
    );
  }

  for (const [key, value] of Object.entries(parametersToEnvironment(parameters))) {
    // An empty string counts as unset: it is what an unfilled `.env` line
    // leaves behind, and it would fail validation later anyway.
    if (environment[key] === undefined || environment[key] === '') {
      environment[key] = value;
    }
  }
}

/** The real reader, paging through Parameter Store and decrypting as it goes. */
export class SsmParameterReader implements ParameterReader {
  private readonly client: SSMClient;

  public constructor(client: SSMClient = new SSMClient({})) {
    this.client = client;
  }

  public async byPath(path: string): Promise<Record<string, string>> {
    const parameters: Record<string, string> = {};
    let nextToken: string | undefined;

    do {
      const response = await this.client.send(
        new GetParametersByPathCommand({
          Path: path,
          Recursive: true,
          // SecureString values arrive encrypted otherwise, and the failure
          // looks like a wrong secret rather than a missing flag.
          WithDecryption: true,
          ...(nextToken === undefined ? {} : { NextToken: nextToken }),
        }),
      );

      for (const parameter of response.Parameters ?? []) {
        if (parameter.Name !== undefined && parameter.Value !== undefined) {
          parameters[parameter.Name] = parameter.Value;
        }
      }
      nextToken = response.NextToken;
    } while (nextToken !== undefined);

    return parameters;
  }
}

/**
 * Container-scoped cache. A warm Lambda reuses it, so repeat invocations make
 * no SSM call at all — which matters for latency, and for staying well clear
 * of the account-wide throughput limit.
 */
const containerCache: ParameterCache = {};

/**
 * Called once at Lambda start. Outside AWS, `SSM_PARAMETER_PATH` is unset and
 * this does nothing, leaving `.env` in charge.
 */
export async function loadSecrets(
  environment: NodeJS.ProcessEnv = process.env,
  reader: ParameterReader = new SsmParameterReader(),
): Promise<void> {
  await loadParametersInto(environment, reader, {
    path: environment['SSM_PARAMETER_PATH'],
    cache: containerCache,
  });
}
