import type { Metadata } from "next";
import Link from "next/link";

import { PhaseStub } from "@/components/app-shell/phase-stub";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { floorplanDetectionReport } from "@/lib/floorplan";

export const metadata: Metadata = { title: "Admin" };

const TOOLS = [
  {
    href: "/admin/floor-plan",
    title: "Floor plan editor",
    body: (interpolated: number) =>
      `Move, rotate and retire desks. ${interpolated} seat${
        interpolated === 1 ? "" : "s"
      } still sit on interpolated positions and are flagged there for checking. Taking a desk out of service is refused while somebody still has it booked, unless you confirm.`,
  },
  {
    href: "/admin/notifications",
    title: "Notifications",
    body: () =>
      "Every message the product has produced, rendered as it would have been sent. In demo mode this is the mailbox — nothing leaves the machine.",
  },
  {
    href: "/admin/qr",
    title: "Desk QR codes",
    body: () =>
      "The printable sheet: one QR sticker per bookable desk. Scanning one checks that person in to that desk, which is what makes occupancy seat-level rather than door-level.",
  },
] as const;

export default function Page() {
  const interpolated = floorplanDetectionReport.bays.reduce((n, b) => n + b.interpolated, 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Available now</CardTitle>
        </CardHeader>
        <CardBody className="divide-y divide-hairline">
          {TOOLS.map((tool) => (
            <div key={tool.href} className="py-3 first:pt-0 last:pb-0">
              <Link
                href={tool.href}
                className="text-sm font-medium text-navy underline underline-offset-4"
              >
                {tool.title}
              </Link>
              <p className="mt-1 max-w-2xl text-sm text-ink-muted">{tool.body(interpolated)}</p>
            </div>
          ))}
        </CardBody>
      </Card>

      <PhaseStub
        title="Admin"
        phase={5}
        summary="Occupancy analytics and seat inventory."
        willInclude={[
          "Occupancy by day, by zone and by team — the numbers partners will use to right-size the floor",
          "Desks needed versus desks held, so the seat count can be argued from data",
          "No-show and auto-release reporting, separating a claim on a desk from evidence it was used",
          "Seat inventory editing: change a desk's type, reallocate a fixed seat",
        ]}
      />
    </div>
  );
}
