/**
 * Which AWS account the deployment scripts act on, and how they are told.
 *
 * **`.env` decides.** `AWS_PROFILE` there names the account, exactly as
 * `.env.example` describes it — "Deploy target. Credentials resolved from the
 * named profile". Every script that touches AWS resolves its identity through
 * this module and nowhere else, so there is one answer rather than one per
 * script.
 *
 * That single answer is the point. `deploy.ts` used to shell out to the `aws`
 * CLI without reading `.env` at all, while `ssm-sync.ts` read `.env` and
 * therefore honoured `AWS_PROFILE`. The two resolved different accounts. Had
 * both had permission, the Hasura admin secret would have gone into one account
 * and the Lambda that reads it into another — and the only symptom would have
 * been a cold start reporting "no parameters found", which points nowhere near
 * the cause.
 *
 * `.env` also wins over the surrounding shell. A profile exported in a terminal
 * is usually left over from something else; the one written down in the project
 * is the deliberate one. When they differ, that is said out loud rather than
 * resolved quietly.
 */

import { execFileSync } from 'node:child_process';

import { config as loadDotenv } from 'dotenv';

/**
 * `.env`, read into its own object.
 *
 * Never merged into `process.env`. These are secrets, and a script that only
 * needs four of them has no reason to publish the rest to every library it
 * loads and every process it spawns. What crosses over does so by name, below.
 */
const fromEnvFile: Record<string, string> = {};
loadDotenv({ quiet: true, processEnv: fromEnvFile });

export interface AwsTarget {
  /** From `.env`. Undefined means the default credential chain. */
  readonly profile: string | undefined;
  readonly region: string;
  readonly stage: string;
}

/** A value from `.env`, falling back to the shell. Empty counts as unset. */
export function fromEnv(key: string): string | undefined {
  const value = fromEnvFile[key] ?? process.env[key];

  return value === undefined || value === '' ? undefined : value;
}

export function awsTarget(): AwsTarget {
  const target: AwsTarget = {
    profile: fromEnv('AWS_PROFILE'),
    region: fromEnv('AWS_REGION') ?? 'us-east-1',
    stage: fromEnv('STAGE') ?? 'prod',
  };

  // Published to `process.env` deliberately, by name, and only these two.
  //
  // The `aws` CLI is told the profile by an explicit `--profile` flag, but the
  // SDK has no equivalent short of a credential-provider dependency: reading
  // `AWS_PROFILE` from the environment is how it selects one. So the variable
  // `.env` named is set here, rather than a whole secrets file being merged in
  // and the SDK left to find what it likes.
  if (target.profile !== undefined) process.env['AWS_PROFILE'] = target.profile;
  process.env['AWS_REGION'] = target.region;

  return target;
}

/**
 * The CLI flags every `aws` invocation carries.
 *
 * `--profile` is passed explicitly rather than exported into the environment,
 * so the account being used is visible in the command itself rather than
 * inherited invisibly from context.
 */
export function awsFlags(target: AwsTarget): string[] {
  return [
    '--region',
    target.region,
    ...(target.profile === undefined ? [] : ['--profile', target.profile]),
  ];
}

/** Runs `aws`, with the target's region and profile already applied. */
export function aws(target: AwsTarget, args: string[], quiet = false): string {
  return execFileSync('aws', [...args, ...awsFlags(target)], {
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
  }).trim();
}

/**
 * Prints the account about to be acted on, and returns it.
 *
 * Called before anything is created. "Which account" is the one thing about
 * these scripts that can be wrong without failing — the previous deployment
 * went to an account nobody had chosen, and every command reported success.
 */
export function announceTarget(target: AwsTarget, what: string): string {
  const account = aws(target, ['sts', 'get-caller-identity', '--output', 'text', '--query', 'Account'], true);
  const shellProfile = process.env['AWS_PROFILE'];

  console.log(what);
  console.log(`  account  ${account}`);
  console.log(`  profile  ${target.profile ?? '(default credential chain)'}`);
  console.log(`  region   ${target.region}`);

  if (shellProfile !== undefined && shellProfile !== '' && shellProfile !== target.profile) {
    console.log(
      `\n  note: the shell exports AWS_PROFILE=${shellProfile}, which is being ignored.\n` +
        '        .env decides the deploy target. Unset one of them if that is not what you want.',
    );
  }

  console.log('');
  return account;
}
