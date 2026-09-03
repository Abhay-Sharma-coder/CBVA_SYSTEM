import type { Metadata } from "next";
import { PhaseStub } from "@/components/app-shell/phase-stub";

export const metadata: Metadata = { title: "Meeting Rooms" };

export default function Page() {
  return (
    <PhaseStub
      title="Meeting Rooms"
      phase={3}
      summary="Boardroom, conference and huddle room booking for Floor 4."
      willInclude={[
        "Book an arbitrary time range, not a fixed slot — overlaps are rejected by the database",
        "Six rooms seeded from the drawing, from the 25-seat Boardroom down to the 4-seat Huddle Room",
        "Two-way sync with Outlook room resource mailboxes via Microsoft Graph",
        "Capacity and amenity filtering",
      ]}
    />
  );
}
