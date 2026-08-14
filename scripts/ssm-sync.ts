/**
 * Puts the Lambda's runtime secrets into SSM Parameter Store, from `.env`.
 *
 *   npm run ssm:sync
 *
 * The deployed function reads these four at cold start and nothing else — see
 * `src/config/secrets.ts`. `SUPABASE_DB_URL` is deliberately absent: the server
 * reaches its data through Hasura over GraphQL and never opens a PostgreSQL
 * socket, so storing the database password in AWS would be protecting a
 * credential nothing uses. See docs/10.
 *
 * Standard tier, `SecureString`, encrypted with the AWS-managed `aws/ssm` key.
 * All three of those are deliberate and all three are free — advanced tier
 * costs $0.05 per parameter per month and a customer-managed key $1 per month,
 * neither of which buys anything here. See ADR 0003 and docs/09.
 *
 * A script rather than four console visits, because the values are secrets: this
 * way they travel from `.env` to AWS without passing through a shell history, a
 * terminal, or a screen. Re-running is safe — it overwrites with what `.env`
 * currently holds, which is also how a rotated secret gets deployed.
 */

import {
  AddTagsToResourceCommand,
  PutParameterCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';

import { announceTarget, awsTarget, fromEnv } from './lib/aws-target';

/**
 * Named after the environment variable each one supplies. The last path segment
 * *is* the variable name — `parametersToEnvironment` relies on that, so this
 * list and `.env.example` read as the same list.
 */
const VARIABLES = [
  'HASURA_GRAPHQL_ENDPOINT',
  'HASURA_ADMIN_SECRET',
  'AUTH0_DOMAIN',
  'AUTH0_AUDIENCE',
] as const;

const PROJECT = 'lumanu-mcp-poc';
const TARGET = awsTarget();
const PATH = `/${PROJECT}/${TARGET.stage}`;

async function main(): Promise<void> {
  const missing = VARIABLES.filter((name) => fromEnv(name) === undefined);
  if (missing.length > 0) {
    throw new Error(`Not set in .env: ${missing.join(', ')}`);
  }

  announceTarget(TARGET, `Writing ${VARIABLES.length} parameters to ${PATH}`);

  // `awsTarget()` has already set AWS_PROFILE from `.env`, so the SDK and the
  // `aws` CLI that printed the account above resolve the same credentials.
  const client = new SSMClient({ region: TARGET.region });

  for (const variable of VARIABLES) {
    const name = `${PATH}/${variable}`;
    const response = await client.send(
      new PutParameterCommand({
        Name: name,
        // Never logged, never echoed. The only place the value appears is here.
        Value: fromEnv(variable)!,
        Type: 'SecureString',
        Tier: 'Standard',
        Overwrite: true,
      }),
    );

    // Tags go on separately: PutParameter rejects Tags and Overwrite together,
    // and re-running this must stay safe.
    await client.send(
      new AddTagsToResourceCommand({
        ResourceType: 'Parameter',
        ResourceId: name,
        Tags: [
          { Key: 'project', Value: PROJECT },
          { Key: 'stage', Value: TARGET.stage },
        ],
      }),
    );

    console.log(`  ${variable.padEnd(24)} version ${response.Version} (SecureString, Standard)`);
  }

  const profileFlag = TARGET.profile === undefined ? '' : ` --profile ${TARGET.profile}`;
  console.log(
    `\nRemove them all with:\n  aws ssm delete-parameters --region ${TARGET.region}${profileFlag} --names \\`,
  );
  console.log(VARIABLES.map((variable) => `    ${PATH}/${variable}`).join(' \\\n'));
}

main().catch((error: unknown) => {
  console.error(`\nFailed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
