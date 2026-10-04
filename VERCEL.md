# Deploying the reader to Vercel

The reader deploys as a Next.js app in a workspace. Vercel reads [`vercel.json`](vercel.json)
at the repository root, so nothing needs configuring in the Vercel UI beyond the project
itself.

## In the Vercel UI

1. **Add New → Project**, and import `dhozil/fideicommis`.
2. **Root Directory: clear it.** Set it to `frontend/` and the build fails with

       Error: The Next.js output directory "frontend/.next" was not found at
       "/vercel/path0/frontend/frontend/.next"

   This is the one setting that has to be changed in the UI, and it cannot be set from
   `vercel.json` — that file is validated against a schema with
   `additionalProperties: false` and has no property for it. An attempt to add one is
   rejected before the build starts:

       The `vercel.json` schema validation failed ... should NOT have additional property

3. **Framework Preset**: Next.js. It will be detected; `vercel.json` states it too.
4. **Build Command** and **Output Directory** come from `vercel.json`, which Vercel reads.
   Leave the UI fields alone.
5. **Environment Variables**: none are required. Every variable the reader reads has a
   default in the source, so a deployment with an empty environment variable list builds
   and runs against Studionet. `.env.example` documents each one if you want to override.

Then **Deploy**. No key goes in there, and none is possible: the reader holds no key and
signs nothing, and `check_deploy.py` fails the build if any file under `frontend/src`
reads a variable whose name contains `PRIVATE`, `KEY`, `SECRET` or `MNEMONIC`.

## Why this file exists at all

Every Vercel setting except one is in `vercel.json`, and that one is here because it lives
in Vercel's dashboard rather than in the repository. A page of documentation is the only
thing that can carry it, which is a weak form of delivery — it is recorded here because the
alternative is a build error that names a missing directory rather than the setting that
caused it.

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