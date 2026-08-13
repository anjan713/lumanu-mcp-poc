/**
 * Bearer token validation.
 *
 * The reviewer mints an Auth0 machine-to-machine token with the
 * `client_credentials` grant and sends it as `Authorization: Bearer <jwt>`.
 * Every request is validated independently — signature, issuer, audience and
 * expiry — which is what a stateless transport requires anyway.
 *
 * The signature is checked against the tenant's published JWKS rather than a
 * pinned key, so Auth0 rotating its signing key does not need a redeploy. That
 * is also the difference between validation and a decode: a token this service
 * did not have the key for is rejected, however well-formed it looks.
 *
 * The full MCP OAuth authorization-server flow — protected-resource metadata,
 * dynamic client registration, PKCE — is deliberately not implemented. See
 * docs/07.
 */

import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';

/** Distinguishable from any other failure, so the transport can answer 401. */
export class AuthError extends Error {
  public override readonly name = 'AuthError';
  public readonly status = 401;

  public constructor(message: string) {
    super(message);
  }
}

/** Where the tenant's public signing keys come from. */
export type KeySource = () => Promise<JSONWebKeySet>;

export interface VerifierConfig {
  readonly issuer: string;
  readonly audience: string;
  /** Omitted in production, where the keys are fetched from the issuer's JWKS. */
  readonly keys?: KeySource;
}

/** What a validated token tells us about the caller. */
export interface CallerIdentity {
  readonly subject: string;
  readonly scopes: readonly string[];
}

export type TokenVerifier = (authorization: string | undefined) => Promise<CallerIdentity>;

const BEARER = /^bearer\s+(.+)$/i;

/**
 * Only RS256 is accepted. Naming it explicitly is what stops a token that
 * claims `alg: "none"`, or a symmetric algorithm keyed on the public key,
 * from being taken at its word.
 */
const ALGORITHMS = ['RS256'] as const;

/**
 * Turns jose's error codes into something a reviewer can act on. Its own
 * messages are precise but cryptic — `"exp" claim timestamp check failed`
 * describes the check rather than the problem, and the first thing anyone
 * wants to know is whether to mint a fresh token or fix their configuration.
 *
 * None of these mention the token itself, so all are safe to return.
 */
function describe(cause: unknown): string {
  const code = (cause as { code?: string }).code;
  const message = (cause as Error).message;

  switch (code) {
    case 'ERR_JWT_EXPIRED':
      return 'the token has expired — mint a fresh one.';
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
      return 'the signature did not verify against the issuer’s published keys.';
    case 'ERR_JWKS_NO_MATCHING_KEY':
      return 'no key published by the issuer matches this token.';
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
      // Names which claim, so a wrong audience is distinguishable from a
      // wrong tenant without reading the token.
      return `a claim did not match what this server expects (${message}).`;
    case 'ERR_JOSE_ALG_NOT_ALLOWED':
      return `its signing algorithm is not accepted — only ${ALGORITHMS.join(', ')}.`;
    case 'ERR_JWS_INVALID':
    case 'ERR_JWT_INVALID':
      return 'it is not a well-formed JWT.';
    default:
      return message;
  }
}

export function createTokenVerifier(config: VerifierConfig): TokenVerifier {
  // Remote by default, and cached by jose between calls so a warm Lambda does
  // not refetch the key set per request. A local set is used in tests, where
  // the keys are generated rather than published.
  const resolveKey =
    config.keys === undefined
      ? createRemoteJWKSet(new URL('.well-known/jwks.json', config.issuer))
      : async (...args: Parameters<ReturnType<typeof createLocalJWKSet>>) =>
          createLocalJWKSet(await config.keys!())(...args);

  return async (authorization) => {
    if (authorization === undefined || authorization.trim() === '') {
      throw new AuthError('No Authorization header. Send: Authorization: Bearer <token>');
    }

    const match = BEARER.exec(authorization.trim());
    if (match?.[1] === undefined) {
      throw new AuthError('Authorization header must use the Bearer scheme.');
    }

    try {
      const { payload } = await jwtVerify(match[1], resolveKey, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms: [...ALGORITHMS],
      });

      return {
        subject: typeof payload.sub === 'string' ? payload.sub : 'unknown',
        scopes: typeof payload['scope'] === 'string' ? payload['scope'].split(' ') : [],
      };
    } catch (cause) {
      throw new AuthError(`Token rejected: ${describe(cause)}`);
    }
  };
}
