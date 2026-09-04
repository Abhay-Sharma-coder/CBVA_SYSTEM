import type { Metadata } from "next";

import { RoomsClient } from "@/app/rooms/rooms-client";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Meeting Rooms" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const settings = await getSettings(db());

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl">Meeting Rooms</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          One day at a time, {settings.officeHours.start} to {settings.officeHours.end}.
          Booked hours are locked; a room is held the moment you confirm, and the
          calendar invitation follows.
        </p>
      </header>
      <RoomsClient />
    </div>
  );
}
