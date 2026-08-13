---
status: accepted
---

# Plain CloudFormation rather than the Serverless Framework

Infrastructure is a CloudFormation template in `infra/cloudformation.yml`, deployed by a
small script that bundles the function and calls the AWS CLI. Earlier documents named the
Serverless Framework as the way CloudFormation would be generated; this supersedes them.
CloudFormation itself — the thing those documents actually cared about — is unchanged.

We changed because **Serverless Framework v4 requires a licence key**. It is free below a
revenue threshold, but it needs an account and a `SERVERLESS_ACCESS_KEY` in the environment
before it will deploy anything. That is an account this project cannot create on the owner's
behalf, and a credential a reader of this repository would have to obtain before the
infrastructure could be rebuilt. Version 3 is MIT-licensed and needs no key, but it is
end-of-life, and adopting a deprecated tool to avoid a signup is a poor trade for a template
this small.

The template is 150 lines and creates nine resources. The framework's value is in the things
this project does not need — many functions, many stages, plugins, per-environment variants.
What it would have done for us is package a zip and upload it to S3, which is twenty lines
of script.

## What we give up

**Packaging conveniences.** The deploy script does the bundling, zipping and uploading
itself. It is explicit rather than magic, which is a fair description of both the cost and
the benefit.

**`serverless remove`.** Teardown is `aws cloudformation delete-stack`, which does the same
thing and is already documented in the resource register.

**`serverless logs` and `serverless invoke`.** The AWS CLI has both.

## What we get

A reviewer can read exactly what will be created, in one file, in the format AWS actually
consumes — with no framework-specific vocabulary in between, and no signup before they can
run it. For a project whose point is that a reader can verify the claims, that is worth
more than the packaging convenience.

The dependency footprint also drops. Neither `serverless` nor the AWS SDK's deployment
machinery is installed; the script uses `esbuild`, which the build already needs, and the
AWS CLI, which is already present.

## Consequences

`CLAUDE.md`, the spec, `docs/06` and `docs/10` said "Serverless Framework". Those have been
corrected rather than left to contradict the repository.

Moving to the framework later is not blocked. The resources are ordinary CloudFormation, and
a `serverless.yml` describing the same nine resources could replace the template without
changing anything above it — the function code knows nothing about how it was deployed.

This decision was taken without the project owner choosing between the options, having
raised it twice and been asked to continue. It is cheap to reverse: the template and the
deploy script are two files.
