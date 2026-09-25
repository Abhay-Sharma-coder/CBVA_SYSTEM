import type { Metadata } from "next";

import { AuditClient } from "./audit-client";

export const metadata: Metadata = { title: "Audit" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl">Audit log</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Every write this product has made, by whom and when — including the ones the scheduled jobs made on their own.
        </p>
      </header>
      <AuditClient />
    </div>
  );
}
