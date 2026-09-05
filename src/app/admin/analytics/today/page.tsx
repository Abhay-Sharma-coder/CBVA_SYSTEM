import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { TodayClient } from "./today-client";

export const metadata: Metadata = { title: "Today — Analytics" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl">Today on the floor</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">Live occupancy for the current date, both slots. It refreshes on its own, so a check-in appears here without anybody reloading.</p>
      </header>
      <Suspense fallback={<Skeleton className="h-96" label="Loading" />}>
        <TodayClient />
      </Suspense>
    </div>
  );
}
