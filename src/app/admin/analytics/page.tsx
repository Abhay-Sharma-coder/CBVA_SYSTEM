import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { TrendsClient } from "./trends-client";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

/**
 * The deliverable.
 *
 * Three screens share one filter vocabulary and one set of measures: Trends
 * (here) answers "what shape is our demand", Today answers "what is happening
 * now", and Forecast answers "what is coming" — which is the thing CBVA said
 * outright they have no way to see.
 */
export default function Page() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl">Occupancy analytics</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          How much of the floor is actually used, and when. The booking flow
          exists to collect this; these are the numbers the desk count should be
          argued from.
        </p>
      </header>
      {/* useSearchParams needs a Suspense boundary to stay static-analysable. */}
      <Suspense fallback={<Skeleton className="h-96" label="Loading analytics" />}>
        <TrendsClient />
      </Suspense>
    </div>
  );
}
