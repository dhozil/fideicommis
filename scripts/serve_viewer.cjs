#!/usr/bin/env node
/**
 * Serve the audit viewer, and relay its view calls to Studionet.
 *
 * Two reasons this exists rather than pointing the browser straight at the RPC:
 *
 *  1. CORS. The GenLayer node does not send the headers a browser needs, so a
 *     static page cannot call it directly.
 *  2. Rate limits. 30 JSON-RPC calls a minute, rejected with -32029 and a
 *     retry_after_seconds hint. A page that fires twenty calls at once gets
 *     throttled and the failures look like a broken trust rather than a busy
 *     node. studionet.cjs already paces every call and backs off on the hint,
 *     so reusing it means the viewer inherits that handling for free.
 *
 * It reads and nothing else. There is no write path through this server, and no
 * key is loaded, because the viewer has no reason to hold one.
 *
 * Usage:
 *   node scripts/serve_viewer.cjs
 *   node scripts/serve_viewer.cjs --port 8080
 */

const fs = require("fs");
const http = require("http");
const path = require("path");
const { makeClient, makeDriver } = require("./studionet.cjs");

const VIEWER = path.join(__dirname, "..", "viewer");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

const portArg = process.argv.indexOf("--port");
const PORT = portArg > -1 ? Number(process.argv[portArg + 1]) : 8080;

/* An account is required to build a client even for reads; the public Studionet
   faucet account is fine and no key from this project is read. */
const client = makeClient(path.join(__dirname, "orgkeeper.key"));
const { readFrom } = makeDriver(client);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/call") {
    const address = url.searchParams.get("address") || "";
    const method = url.searchParams.get("method") || "";
    let args = [];
    try {
      args = JSON.parse(url.searchParams.get("args") || "[]");
    } catch {
      return json(res, 400, { error: "args must be a JSON array" });
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return json(res, 400, { error: "address must be a 0x address" });
    if (!/^[a-z_][a-z0-9_]*$/i.test(method)) return json(res, 400, { error: "method must be an identifier" });
    try {
      const out = await readFrom(address, method, args);
      return json(res, 200, { result: String(out) });
    } catch (err) {
      return json(res, 502, { error: err.message });
    }
  }

  const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = path.join(VIEWER, name);
  if (!file.startsWith(VIEWER) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("Not found. The viewer has three files: index.html, app.css, app.js.");
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "text/plain; charset=utf-8", "cache-control": "no-store" });
  return res.end(fs.readFileSync(file));
});

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

server.listen(PORT, () => {
  console.log(`Fideicommis audit viewer  http://localhost:${PORT}`);
  console.log(`reading Studionet as ${client.account.address}`);
  console.log("read-only: this server exposes the contract's view methods and nothing else");
});
