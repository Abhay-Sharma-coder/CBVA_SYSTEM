"use client";

/**
 * The one button on the QR landing page.
 *
 * A GET must not mutate, so the scan resolves the situation and this confirms
 * it. `method: "qr"` is recorded on the booking, which is the point of the
 * whole flow: analytics can then tell a desk somebody actually sat at from a
 * door swipe that only proves they reached the floor.
 */
import { useState } from "react";

import { useCheckIn, type ApiError } from "@/components/booking/use-bookings";
import { SeatSwatchWithGlyph } from "@/components/seat/seat-swatch";
import { Button } from "@/components/ui/button";
import { Card, CardBody, StatusMessage } from "@/components/ui/primitives";

export function CheckInConfirm({
  seatCode,
  bookingId,
  slotLabel,
  alreadyCheckedIn,
  checkedInAtLabel,
  occupantName,
}: {
  seatCode: string;
  bookingId: string;
  slotLabel: string;
  alreadyCheckedIn: boolean;
  checkedInAtLabel: string | null;
  occupantName: string;
}) {
  const checkIn = useCheckIn();
  const [done, setDone] = useState(alreadyCheckedIn);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setError(null);
    try {
      await checkIn.mutateAsync({ bookingId, method: "qr" });
      setDone(true);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="flex items-center gap-4">
          <SeatSwatchWithGlyph status={done ? "checked_in" : "your_booking"} code={seatCode} />
          <div>
            <p className="text-sm text-ink">{occupantName}</p>
            <p className="text-xs text-ink-subtle tabular">{slotLabel}</p>
          </div>
        </CardBody>
      </Card>

      {done ? (
        <StatusMessage tone="positive">
          {alreadyCheckedIn && checkedInAtLabel
            ? `You checked in to ${seatCode} at ${checkedInAtLabel}. Nothing more to do.`
            : `Checked in to ${seatCode}. The desk is recorded as in use.`}
        </StatusMessage>
      ) : null}

      {error ? <StatusMessage tone="danger">{error}</StatusMessage> : null}

      {!done ? (
        <Button variant="primary" size="lg" className="w-full" onClick={onConfirm} disabled={checkIn.isPending}>
          {checkIn.isPending ? "Checking in…" : `Check in to ${seatCode}`}
        </Button>
      ) : (
        <a
          href="/bookings"
          className="inline-block text-sm text-navy underline underline-offset-4 hover:text-ink"
        >
          See my bookings
        </a>
      )}
    </div>
  );
}
