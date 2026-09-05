import type { Metadata } from "next";

import { UsersClient } from "./users-client";

export const metadata: Metadata = { title: "People" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl">People</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Grade, seat mode, allocated desk and administrator access. The grade split here sets the denominator for every number in the analytics.
        </p>
      </header>
      <UsersClient />
    </div>
  );
}
