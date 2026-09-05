import { Suspense } from "react";

import { AnalyticsTabs } from "./analytics-tabs";

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      {/* useSearchParams needs a boundary; the tabs carry the filters across
          views, so they have to read it. */}
      <Suspense fallback={<div className="h-10" />}>
        <AnalyticsTabs />
      </Suspense>
      {children}
    </div>
  );
}
