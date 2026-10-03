import { NextResponse } from "next/server";
import { FEATURED_TRUST } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness for the reader, including the part that matters: whether the GenLayer
 * node is answering, and whether it is rate-limiting us. A reader that cannot
 * reach the chain should say so here rather than looking like a broken page.
 */
export async function GET() {
  const checks: Record<string, string> = {};

  try {
    const res = await fetch("https://studio.genlayer.com/api", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      cache: "no-store",
    });
    const body = (await res.json()) as { result?: string };
    checks.chainId = body.result ?? "no result";
  } catch (err) {
    checks.chainId = `unreachable: ${(err as Error).message.slice(0, 80)}`;
  }

  return NextResponse.json({
    app: "fideicommis-web",
    readOnly: true,
    signs: false,
    holdsKeys: false,
    // The same variable the reader itself features, read through the registry rather
    // than a second literal. It used to be named NEXT_PUBLIC_EXAMPLE_TRUST with its own
    // fallback to a different address than the one the site features, so a health check
    // could report a trust the landing page was not showing. Two variables for one
    // meaning is how those drift apart.
    example: FEATURED_TRUST,
    checks,
  });
}
