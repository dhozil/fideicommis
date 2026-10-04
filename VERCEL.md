# Deploying the reader to Vercel

The reader deploys as a Next.js app in a workspace. Vercel reads [`vercel.json`](vercel.json)
at the repository root, so nothing needs configuring in the Vercel UI beyond the project
itself.

## In the Vercel UI

1. **Add New → Project**, and import `dhozil/fideicommis`.
2. **Deploy.** Either Root Directory works — leave the field empty, or set it to
   `frontend/`. Both are configured:

   | Root Directory | file Vercel reads | `outputDirectory` |
   | --- | --- | --- |
   | *(empty)* | [`vercel.json`](vercel.json) | `frontend/.next` |
   | `frontend/` | [`frontend/vercel.json`](frontend/vercel.json) | `.next` |

   The error this avoids:

       Error: The Next.js output directory "frontend/.next" was not found at
       "/vercel/path0/frontend/frontend/.next"

   Vercel resolves `outputDirectory` relative to the Root Directory, so one setting with
   the other root's value produces a path that cannot exist. There is no `rootDirectory`
   property in `vercel.json` — it is validated with `additionalProperties: false`, and
   adding one is rejected before the build starts:

       The `vercel.json` schema validation failed ... should NOT have additional property

   So the repository cannot pin the setting, and carries a config for each root instead.
3. **Environment Variables**: none are required. Every variable the reader reads has a
   default in the source, so a deployment with an empty environment variable list builds
   and runs against Studionet. `.env.example` documents each one if you want to override.

Then **Deploy**. No key goes in there, and none is possible: the reader holds no key and
signs nothing, and `check_deploy.py` fails the build if any file under `frontend/src`
reads a variable whose name contains `PRIVATE`, `KEY`, `SECRET` or `MNEMONIC`.

## Why there are two `vercel.json` files

The Root Directory lives in Vercel's dashboard and has no equivalent in the repository, so
one of these two is right and the repository cannot tell which. Writing both means the
deployment succeeds either way, and `check_ci_paths.py` asserts both are present with the
value each root needs — otherwise a fix for one root silently breaks the other.

## What is worth checking afterwards

```bash
curl -s https://<your-deployment>/api/health | python -m json.tool
```

`readOnly: true`, `signs: false` and `holdsKeys: false` are the claims that matter. The
same endpoint reports whether the GenLayer node is reachable from the deployment, which is
the one thing a local build cannot tell you.

Then open `/verify` and paste a transaction hash. Four outcomes stay apart on purpose:
*no record*, *not yet decided*, *rolled back*, *settled*.

## If the build fails

`python check_deploy.py` on your own machine checks the four things that decide a Vercel
build — the install command, the build command resolving to a real script, the output
directory, and the framework — plus whether the build succeeds with **no environment
variables set at all**, which is what a fresh project looks like. It is in CI, so a green
main branch means the configuration is coherent.

One trap worth naming: `.next/` does not match a sibling named `.next.stashed`, and this
repository's own history contains that mistake. If a build output directory ever appears
in a diff, the ignore rule has a hole in it.

## Notes

- The reader is server-rendered and reads the node on each request, coalesced and cached
  for 30–60 seconds. A serverless function is stateless between invocations, so the cache
  is per-instance: it reduces load within an instance, not across the deployment. That is
  the right trade for a reader that must show what the chain says now, but it means a
  cold function costs a full round trip to the node.
- The node allows 30 requests a minute per IP. A shared Vercel egress IP serving several
  visitors could reach that. The cache and the batching in `lib/genlayer.ts` exist because
  of it; if you see `-32029`, a shorter cache TTL is the first thing to try.
- A browser-like User-Agent is required or Cloudflare answers with error 1010. The reader's
  server-side reads set one.