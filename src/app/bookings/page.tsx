import type { Metadata } from "next";
import { PhaseStub } from "@/components/app-shell/phase-stub";

export const metadata: Metadata = { title: "My Bookings" };

export default function Page() {
  return (
    <PhaseStub
      title="My Bookings"
      phase={3}
      summary="Your upcoming and past desk bookings, and the check-in flow."
      willInclude={[
        "Book, amend and cancel a desk for the AM or PM slot",
        "Check in from your phone, or by badging in at the door",
        "The two-hour auto-release rule, running as a real job against real bookings",
        "Booking on behalf of a colleague, for admin staff and above",
      ]}
    />
  );
}
