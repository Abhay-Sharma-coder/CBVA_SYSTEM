import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { ForecastClient } from "./forecast-client";

export const metadata: Metadata = { title: "Forecast — Analytics" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl">Forecast</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">Expected occupancy for the next five working days — the thing CBVA said they have no way to see today. Numbers rise as each day approaches, because most people book the evening before.</p>
      </header>
      <Suspense fallback={<Skeleton className="h-96" label="Loading" />}>
        <ForecastClient />
      </Suspense>
    </div>
  );
}
