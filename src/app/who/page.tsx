import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { WhoClient } from "./who-client";

export const metadata: Metadata = { title: "Who's In" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl">Who&rsquo;s in</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Who is booked into the office on a given day, and where they are
          sitting. Colleagues with an allocated desk are listed too — they never
          book, they simply have one.
        </p>
      </header>
      <Suspense fallback={<Skeleton className="h-80" label="Loading" />}>
        <WhoClient />
      </Suspense>
    </div>
  );
}
