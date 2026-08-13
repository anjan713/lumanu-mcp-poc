/**
 * Token validation, exercised against real signatures.
 *
 * Keys are generated here and tokens signed with them, so every case below is
 * a genuine cryptographic check rather than a stubbed boolean. That matters:
 * the failure this guards against is validation that looks present and is
 * really a string comparison.
 */

import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';

import { AuthError, createTokenVerifier, type KeySource } from '@/auth/verify';

const ISSUER = 'https://tenant.us.auth0.com/';
const AUDIENCE = 'https://lumanu-mcp-poc/api';

interface Signer {
  readonly sign: (claims: Record<string, unknown>, overrides?: Overrides) => Promise<string>;
  readonly keys: KeySource;
}

interface Overrides {
  readonly issuer?: string;
  readonly audience?: string;
  readonly expiresIn?: string;
  readonly notBefore?: string;
}

/** A key pair plus the JWKS a verifier would fetch for it. */
async function signerFor(kid = 'test-key'): Promise<Signer> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };

  return {
    keys: () => Promise.resolve({ keys: [jwk] }),
    sign: (claims, overrides = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuedAt()
        .setIssuer(overrides.issuer ?? ISSUER)
        .setAudience(overrides.audience ?? AUDIENCE)
        .setExpirationTime(overrides.expiresIn ?? '5m')
        .sign(privateKey),
  };
}

async function verifierFor(signer: Signer) {
  return createTokenVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: signer.keys });
}

describe('a valid token', () => {
  it('is accepted and its subject reported', async () => {
    const signer = await signerFor();
    const verify = await verifierFor(signer);

    const claims = await verify(`Bearer ${await signer.sign({ sub: 'client@clients' })}`);

    expect(claims.subject).toBe('client@clients');
  });

  it('carries its scopes through, so authorisation can be added later', async () => {
    const signer = await signerFor();
    const verify = await verifierFor(signer);

    const claims = await verify(
      `Bearer ${await signer.sign({ sub: 'c', scope: 'read:workspaces read:payables' })}`,
    );

    expect(claims.scopes).toEqual(['read:workspaces', 'read:payables']);
  });

  it('reports no scopes rather than failing when the token carries none', async () => {
    const signer = await signerFor();
    const verify = await verifierFor(signer);

    expect((await verify(`Bearer ${await signer.sign({ sub: 'c' })}`)).scopes).toEqual([]);
  });

  it('accepts the header however it is capitalised', async () => {
    const signer = await signerFor();
    const verify = await verifierFor(signer);
    const token = await signer.sign({ sub: 'c' });

    await expect(verify(`bearer ${token}`)).resolves.toBeDefined();
    await expect(verify(`BEARER ${token}`)).resolves.toBeDefined();
  });
});

describe('a request that must be rejected', () => {
  it('has no Authorization header at all', async () => {
    const verify = await verifierFor(await signerFor());

    await expect(verify(undefined)).rejects.toThrow(AuthError);
  });

  it('has an empty Authorization header', async () => {
    const verify = await verifierFor(await signerFor());

    await expect(verify('')).rejects.toThrow(AuthError);
  });

  it('uses a scheme other than Bearer', async () => {
    const signer = await signerFor();
    const verify = await verifierFor(signer);

    await expect(verify(`Basic ${await signer.sign({ sub: 'c' })}`)).rejects.toThrow(/Bearer/);
  });

  it('carries something that is not a token', async () => {
    const verify = await verifierFor(await signerFor());

    await expect(verify('Bearer not-a-jwt')).rejects.toThrow(AuthError);
  });

  it('has expired', async () => {
    const signer = await signerFor();
    const verify = await verifierFor(signer);
    const expired = await signer.sign({ sub: 'c' }, { expiresIn: '-1m' });

    await expect(verify(`Bearer ${expired}`)).rejects.toThrow(AuthError);
  });

  it('names expiry as the reason, so a stale token is obvious', async () => {
    const signer = await signerFor();
    const verify = await verifierFor(signer);
    const expired = await signer.sign({ sub: 'c' }, { expiresIn: '-1m' });

    await expect(verify(`Bearer ${expired}`)).rejects.toThrow(/expired/i);
  });

  it('was issued for a different audience', async () => {
    const signer = await signerFor();
    const verify = await verifierFor(signer);
    const wrong = await signer.sign({ sub: 'c' }, { audience: 'https://someone-elses/api' });

    await expect(verify(`Bearer ${wrong}`)).rejects.toThrow(AuthError);
  });

  it('was issued by a different tenant', async () => {
    const signer = await signerFor();
    const verify = await verifierFor(signer);
    const wrong = await signer.sign({ sub: 'c' }, { issuer: 'https://attacker.example.com/' });

    await expect(verify(`Bearer ${wrong}`)).rejects.toThrow(AuthError);
  });

  /** The check that makes this real validation rather than a decode. */
  it('was signed by a key the tenant does not publish', async () => {
    const attacker = await signerFor();
    const legitimate = await signerFor();
    const verify = await verifierFor(legitimate);

    const forged = await attacker.sign({ sub: 'admin' });

    await expect(verify(`Bearer ${forged}`)).rejects.toThrow(AuthError);
  });

  it('claims the "none" algorithm', async () => {
    const signer = await signerFor();
    const verify = await verifierFor(signer);

    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ sub: 'admin', iss: ISSUER, aud: AUDIENCE, exp: 9_999_999_999 }),
    ).toString('base64url');

    await expect(verify(`Bearer ${header}.${body}.`)).rejects.toThrow(AuthError);
  });
});

describe('signing-key rotation', () => {
  /**
   * Validation resolves the key by `kid` from whatever the key source
   * currently publishes, so a tenant that rotates its signing key keeps
   * working without a redeploy.
   */
  it('accepts a token signed by a newly published key', async () => {
    const oldKey = await signerFor('old-key');
    const newKey = await signerFor('new-key');

    let published = oldKey.keys;
    const verify = createTokenVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      keys: () => published(),
    });

    await expect(verify(`Bearer ${await oldKey.sign({ sub: 'c' })}`)).resolves.toBeDefined();

    // The tenant rotates: the new key is published alongside nothing else.
    published = newKey.keys;

    await expect(verify(`Bearer ${await newKey.sign({ sub: 'c' })}`)).resolves.toBeDefined();
  });
});

describe('the error it raises', () => {
  it('is distinguishable by kind, so the transport can answer 401', async () => {
    const verify = await verifierFor(await signerFor());

    await expect(verify(undefined)).rejects.toMatchObject({ name: 'AuthError', status: 401 });
  });

  it('never repeats the token back in the message', async () => {
    const signer = await signerFor();
    const verify = await verifierFor(signer);
    const expired = await signer.sign({ sub: 'c' }, { expiresIn: '-1m' });

    await expect(verify(`Bearer ${expired}`)).rejects.not.toThrow(new RegExp(expired.slice(0, 40)));
  });
});
