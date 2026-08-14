/**
 * Deploys the stack.
 *
 *   npm run bundle && npm run deploy
 *
 * Everything it does is visible: create an artefact bucket if one is missing,
 * upload the zip under a content-addressed key, then hand
 * `infra/cloudformation.yml` to CloudFormation. No framework, no account, no
 * plugin — see ADR 0004.
 *
 * Re-running is safe. CloudFormation computes the difference, and an unchanged
 * bundle produces the same S3 key, so a no-op deploy changes nothing.
 *
 * Teardown is `npm run destroy`, or the commands in docs/10.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { announceTarget, aws as runAws, awsTarget, fromEnv } from './lib/aws-target';

const ROOT = path.join(__dirname, '..');
const ZIP = path.join(ROOT, 'build', 'handler.zip');
const TEMPLATE = path.join(ROOT, 'infra', 'cloudformation.yml');

const PROJECT = 'lumanu-mcp-poc';
/**
 * Resolved from `.env`, not from the surrounding shell.
 *
 * This script previously read neither, so `AWS_PROFILE` in `.env` — documented
 * there as the deploy target — was ignored and the default credential chain
 * decided the account instead. `ssm-sync.ts` did read `.env`, so the secrets and
 * the stack that reads them could land in two different accounts. They now
 * resolve through one module, so they cannot disagree.
 */
const TARGET = awsTarget();
const STAGE = TARGET.stage;
const REGION = TARGET.region;
const STACK = `${PROJECT}-${STAGE}`;
const SSM_PATH = `/${PROJECT}/${STAGE}`;

/** Every resource carries these, so the bill can be filtered to this project. */
const TAGS = [`project=${PROJECT}`, `stage=${STAGE}`, 'managed-by=cloudformation'];

function aws(args: string[], quiet = false): string {
  return runAws(TARGET, args, quiet);
}

/**
 * One bucket per account and region, reused across deploys. Named from the
 * account id because S3 bucket names are globally unique.
 */
function ensureArtifactBucket(account: string): string {
  const bucket = `${PROJECT}-artifacts-${account}-${REGION}`;

  try {
    aws(['s3api', 'head-bucket', '--bucket', bucket], true);
    console.log(`  bucket   ${bucket} (exists)`);
    return bucket;
  } catch {
    // us-east-1 rejects a LocationConstraint; every other region requires one.
    const location = REGION === 'us-east-1' ? [] : ['--create-bucket-configuration', `LocationConstraint=${REGION}`];
    aws(['s3api', 'create-bucket', '--bucket', bucket, ...location], true);
    aws(['s3api', 'put-public-access-block', '--bucket', bucket,
      '--public-access-block-configuration',
      'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'], true);
    console.log(`  bucket   ${bucket} (created, public access blocked)`);
    return bucket;
  }
}

function main(): void {
  const zip = readFileSync(ZIP);
  // Content-addressed, so an unchanged bundle deploys as a no-op and a changed
  // one always produces a new key — Lambda only redeploys code when the key
  // changes, so a fixed name would silently serve stale code.
  const digest = createHash('sha256').update(zip).digest('hex').slice(0, 16);
  const key = `${STAGE}/handler-${digest}.zip`;

  const account = announceTarget(TARGET, `Deploying ${STACK}`);
  const bucket = ensureArtifactBucket(account);

  aws(['s3', 'cp', ZIP, `s3://${bucket}/${key}`], true);
  console.log(`  artefact s3://${bucket}/${key} (${Math.round(zip.length / 1024)} KB)`);

  aws([
    'cloudformation', 'deploy',
    '--stack-name', STACK,
    '--template-file', TEMPLATE,
    '--capabilities', 'CAPABILITY_NAMED_IAM',
    '--no-fail-on-empty-changeset',
    '--tags', ...TAGS,
    '--parameter-overrides',
    `ProjectName=${PROJECT}`,
    `Stage=${STAGE}`,
    `ArtifactBucket=${bucket}`,
    `ArtifactKey=${key}`,
    `SsmParameterPath=${SSM_PATH}`,
    `LumanuProvider=${fromEnv('LUMANU_PROVIDER') ?? 'mock'}`,
  ]);

  const outputs = JSON.parse(
    aws(['cloudformation', 'describe-stacks', '--stack-name', STACK,
      '--query', 'Stacks[0].Outputs', '--output', 'json'], true),
  ) as Array<{ OutputKey: string; OutputValue: string }>;

  console.log('\nStack outputs:');
  for (const { OutputKey, OutputValue } of outputs) {
    console.log(`  ${OutputKey.padEnd(14)} ${OutputValue}`);
  }

  const endpoint = outputs.find((output) => output.OutputKey === 'McpEndpoint')?.OutputValue;
  console.log(
    `\nConnect with:\n  claude mcp add --transport http lumanu ${endpoint ?? '<endpoint>'} ` +
      '--header "Authorization: Bearer $TOKEN"',
  );
}

try {
  main();
} catch (error) {
  console.error(`\nDeploy failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
