/**
 * Prints a demo bearer token for the deployed MCP server.
 *
 *   npm run --silent token
 *
 * Nothing but the token reaches stdout, so it can be assigned straight to the
 * variable `.mcp.json` expands:
 *
 *   PowerShell   $env:LUMANU_TOKEN = (npm run --silent token)
 *   Bash         export LUMANU_TOKEN=$(npm run --silent token)
 *
 * The Auth0 `client_credentials` grant, which is what the Lambda validates on
 * every request — signature against the tenant's published keys, then issuer,
 * audience and expiry. Tokens last 24 hours, so this is a once-a-day step
 * rather than something to wire into a request path.
 *
 * Read from `.env` into its own object rather than into `process.env`, for the
 * same reason `ssm-sync.ts` does: a script that needs four values has no reason
 * to publish the rest to everything it loads.
 */

import { config as loadDotenv } from 'dotenv';

const env: Record<string, string> = {};
loadDotenv({ quiet: true, processEnv: env });

const REQUIRED = [
  'AUTH0_DOMAIN',
  'AUTH0_AUDIENCE',
  'AUTH0_M2M_CLIENT_ID',
  'AUTH0_M2M_CLIENT_SECRET',
] as const;

async function main(): Promise<void> {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Not set in .env: ${missing.join(', ')}`);
  }

  const response = await fetch(`https://${env['AUTH0_DOMAIN']!}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: env['AUTH0_M2M_CLIENT_ID'],
      client_secret: env['AUTH0_M2M_CLIENT_SECRET'],
      audience: env['AUTH0_AUDIENCE'],
      grant_type: 'client_credentials',
    }),
  });

  if (!response.ok) {
    // The body is deliberately not repeated: a refused token exchange can echo
    // back what was sent, and what was sent includes the client secret.
    throw new Error(`Auth0 answered ${response.status} to the token request.`);
  }

  const granted = (await response.json()) as { access_token?: string };
  if (granted.access_token === undefined) {
    throw new Error('Auth0 returned no access_token.');
  }

  // stdout carries the token and nothing else. Anything explanatory goes to
  // stderr, so command substitution captures a usable value.
  process.stdout.write(granted.access_token);
}

main().catch((error: unknown) => {
  console.error(`Could not mint a token: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
