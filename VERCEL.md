# Deploying the reader to Vercel

The reader deploys as a Next.js app in a workspace. Vercel reads [`vercel.json`](vercel.json)
at the repository root, so nothing needs configuring in the Vercel UI beyond the project
itself.

## In the Vercel UI

1. **Add New → Project**, and import `dhozil/fideicommis`.
2. **Root Directory**: leave it at the repository root. The reader is a workspace, and
   setting this to `frontend/` breaks the build, because the lockfile and the root
   scripts are one level up.
3. **Framework Preset**: Next.js. It will be detected; `vercel.json` states it too.
4. **Build Command**: `npm run build`. **Output Directory**: `frontend/.next`. Both are in
   `vercel.json`, so the fields should fill themselves — check that they did.
5. **Environment Variables**: none are required. Every variable the reader reads has a
   default in the source, so a deployment with an empty environment variable list builds
   and runs against Studionet. `.env.example` documents each one if you want to override.

Then **Deploy**. No key goes in there, and none is possible: the reader holds no key and
signs nothing, and `check_deploy.py` fails the build if any file under `frontend/src`
reads a variable whose name contains `PRIVATE`, `KEY`, `SECRET` or `MNEMONIC`.

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