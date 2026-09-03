import type { Metadata } from "next";
import { PhaseStub } from "@/components/app-shell/phase-stub";

export const metadata: Metadata = { title: "Admin" };

export default function Page() {
  return (
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
  );
}
