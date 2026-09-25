import type { Metadata } from "next";

import { SeatsClient } from "./seats-client";

export const metadata: Metadata = { title: "Seats" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl">Seat inventory</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Every desk on Floor 4, and what it is for. Allocating a desk here is how open question A2 gets answered without touching code.
        </p>
      </header>
      <SeatsClient />
    </div>
  );
}
