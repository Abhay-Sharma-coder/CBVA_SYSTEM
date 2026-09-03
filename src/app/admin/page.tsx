import type { Metadata } from "next";
import Link from "next/link";

import { PhaseStub } from "@/components/app-shell/phase-stub";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { floorplanDetectionReport } from "@/lib/floorplan";

export const metadata: Metadata = { title: "Admin" };

export default function Page() {
  const interpolated = floorplanDetectionReport.bays.reduce(
    (n, b) => n + b.interpolated,
    0,
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Available now</CardTitle>
        </CardHeader>
        <CardBody>
          <Link
            href="/admin/floor-plan"
            className="text-sm font-medium text-navy underline underline-offset-4"
          >
            Floor plan editor
          </Link>
          <p className="mt-1 text-sm text-ink-muted">
            Move, rotate and retire desks. {interpolated} seat
            {interpolated === 1 ? "" : "s"} still sit on interpolated positions and are
            flagged there for checking.
          </p>
        </CardBody>
      </Card>

      <PhaseStub
        title="Admin"
        phase={5}
        summary="Occupancy analytics, seat inventory and the notification outbox."
        willInclude={[
          "Occupancy by day, by zone and by team — the numbers partners will use to right-size the floor",
          "Desks needed versus desks held, so the seat count can be argued from data",
          "No-show and auto-release reporting",
          "Seat inventory editing: block a desk, change its type, reallocate a fixed seat",
          "The notification log, which in demo mode is where every email goes instead of a mailbox",
        ]}
      />
    </div>
  );
}
