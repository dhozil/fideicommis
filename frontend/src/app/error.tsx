"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Failure, in the interface's voice rather than a stack trace.
 *
 * The common case here is not a broken application: it is a rate-limited public
 * node. GenLayer allows 30 reads a minute per IP and this reader spends a budget
 * on every page. Saying "wait a minute and read again" is the actionable
 * instruction; a 500 is not.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("reader failed", error);
  }, [error]);

  const rateLimited = /rate limit|too many requests|-32029/i.test(error.message);

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <span className="eyebrow">Fideicommis</span>
          <h1>{rateLimited ? "The node is rate-limiting us" : "This trust could not be read"}</h1>
        </div>
        <div className="right">
          <Link href="/">Start again</Link>
        </div>
      </header>

      <main id="main">
        <div className="notice">
          {rateLimited ? (
            <>
              GenLayer allows 30 reads a minute for an IP, and every page here spends part of that budget. Wait about a
              minute, then read again. The record is not lost, and nothing about the trust changed.
            </>
          ) : (
            <>
              Something in the chain did not answer in a way this reader understands. The contract may not be a Fideicommis,
              or the node may be unreachable.
            </>
          )}
        </div>

        <section className="hero hero-tight">
          <p className="prose">
            {rateLimited ? null : <strong>What the node said: </strong>}
            {error.message.slice(0, 300)}
          </p>
          <div className="form">
            <button type="button" onClick={reset}>
              Try again
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
