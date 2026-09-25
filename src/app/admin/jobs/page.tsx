import type { Metadata } from "next";

import { JobsClient } from "./jobs-client";

export const metadata: Metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl">Scheduled jobs</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Auto-release, recurring bookings, the notification outbox and the calendar retry. What they would do next, and what they have already done.
        </p>
      </header>
      <JobsClient />
    </div>
  );
}
