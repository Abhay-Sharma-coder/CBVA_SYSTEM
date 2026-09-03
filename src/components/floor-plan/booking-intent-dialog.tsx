"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/primitives";
import { SeatSwatchWithGlyph } from "@/components/seat/seat-swatch";
import { SEAT_STATUS_TOKENS } from "@/components/seat/seat-status";
import type { FloorPlanSeat, SlotDefinition, SlotKey } from "@/components/floor-plan/types";

/**
 * Phase 2 opens the booking flow and stops there — Phase 3 owns the write.
 *
 * It is a real dialog rather than a toast because the confirm step is where
 * Phase 3 will add the on-behalf-of picker and the cut-off warning, and
 * because the seat, date and slot a user is about to commit to should be
 * spelled out before they commit to it.
 */
export function BookingIntentDialog({
  seat,
  date,
  slot,
  slotDefinition,
  onClose,
}: {
  seat: FloorPlanSeat | null;
  date: string | null;
  slot: SlotKey;
  slotDefinition: SlotDefinition | null;
  onClose: () => void;
}) {
  if (!seat) return null;
  const token = SEAT_STATUS_TOKENS[seat.status];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`Book seat ${seat.seatCode}`}
        description={`Zone ${seat.zone}, bay ${seat.bay}`}
      >
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Seat</dt>
            <dd>
              <SeatSwatchWithGlyph status={seat.status} code={seat.seatCode} />
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Status</dt>
            <dd>{token.label}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Date</dt>
            <dd className="tabular">{date ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Slot</dt>
            <dd className="tabular">
              {slotDefinition
                ? `${slotDefinition.label} · ${slotDefinition.start}–${slotDefinition.end}`
                : slot}
            </dd>
          </div>
        </dl>

        <p className="mt-4 rounded-sm border border-dashed border-hairline bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
          Booking is wired up in Phase 3. The intent has been recorded; the
          database constraint that makes two people booking the same desk safe
          is already in place and proven.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" disabled>
            Confirm booking
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
