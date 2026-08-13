/**
 * Bundles the Lambda into one file and zips it.
 *
 *   npm run bundle
 *
 * esbuild follows the imports from the handler and inlines everything the
 * function actually uses, so the artefact carries no `node_modules` and no
 * dead code. That keeps the upload small and the cold start short.
 *
 * Produces `build/handler.zip`, which `npm run deploy` uploads.
 */

import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import AdmZip from 'adm-zip';
import { build } from 'esbuild';

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'build');
const BUNDLE = path.join(OUT_DIR, 'handler.js');
const ZIP = path.join(OUT_DIR, 'handler.zip');

async function main(): Promise<void> {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  await build({
    entryPoints: [path.join(ROOT, 'src', 'lambda', 'handler.ts')],
    outfile: BUNDLE,
    bundle: true,
    platform: 'node',
    // Matches the runtime in infra/cloudformation.yml. Bundling for a newer
    // target than the runtime is a failure that only appears at invocation.
    target: 'node20',
    format: 'cjs',
    minify: true,
    sourcemap: false,
    // Provided by the runtime, so bundling it would only add weight.
    external: ['@aws-sdk/*'],
    logLevel: 'warning',
  });

  const zip = new AdmZip();
  zip.addLocalFile(BUNDLE);
  zip.writeZip(ZIP);

  // A tiny zip usually means the bundle failed to resolve the entry point and
  // produced an almost-empty file, which deploys happily and then fails at
  // invocation with a confusing module error.
  const bundleKb = Math.round(statSync(BUNDLE).size / 1024);
  const zipKb = Math.round(statSync(ZIP).size / 1024);
  if (bundleKb < 50) {
    throw new Error(`The bundle is only ${bundleKb} KB, which is too small to be correct.`);
  }

  // Recorded so the deploy script can key the S3 object on the content.
  writeFileSync(path.join(OUT_DIR, 'size.txt'), `${bundleKb}`, 'utf8');
  console.log(`bundled ${bundleKb} KB → zipped ${zipKb} KB  (build/handler.zip)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
