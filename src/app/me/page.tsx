import type { Metadata } from "next";

import { MeClient } from "./me-client";

export const metadata: Metadata = { title: "Your settings" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl">Your settings</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          What colleagues can see about where you are sitting.
        </p>
      </header>
      <MeClient />
    </div>
  );
}
