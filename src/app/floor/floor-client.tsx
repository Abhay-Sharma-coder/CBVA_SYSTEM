"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useReducedMotion } from "motion/react";

import { FloorPlan } from "@/components/floor-plan/floor-plan";
import {
  DateStrip,
  Legend,
  OccupancyCount,
  SlotToggle,
  ViewToggle,
  ZoneFilter,
} from "@/components/floor-plan/controls";
import { BookingIntentDialog } from "@/components/floor-plan/booking-intent-dialog";
import type {
  BookableDay,
  FloorPlanPayload,
  FloorPlanSeat,
  SlotDefinition,
} from "@/components/floor-plan/types";
import { Card, CardBody } from "@/components/ui/primitives";
import { useUiStore } from "@/lib/store/ui";

interface DatesPayload {
  timezone: string;
  bookingWindowDays: number;
  days: BookableDay[];
  slots: SlotDefinition[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request to ${url} failed with ${res.status}`);
  return res.json() as Promise<T>;
}

export function FloorClient() {
  const {
    activeDate,
    setActiveDate,
    activeSlot,
    setActiveSlot,
    activeZone,
    setActiveZone,
    focusedSeatCode,
    setFocusedSeatCode,
    view,
    setView,
  } = useUiStore();

  const [intent, setIntent] = useState<FloorPlanSeat | null>(null);
  const reduceMotion = useReducedMotion() ?? false;

  /* ---- the URL is the shareable copy of what is on screen ----
     "Have a look at Zone C on Tuesday afternoon" has to be a link, not a list
     of instructions. Date, slot, zone and view all round-trip through the
     query string; the store stays the single reader for the rest of the UI. */
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const date = params.get("date");
    const slot = params.get("slot");
    const zone = params.get("zone");
    const v = params.get("view");
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) setActiveDate(date);
    if (slot === "AM" || slot === "PM") setActiveSlot(slot);
    if (zone === "A" || zone === "B" || zone === "C" || zone === "D") setActiveZone(zone);
    if (v === "list" || v === "plan") setView(v);
  }, [params, setActiveDate, setActiveSlot, setActiveZone, setView]);

  useEffect(() => {
    if (!hydrated.current || activeDate === null) return;
    const next = new URLSearchParams();
    next.set("date", activeDate);
    next.set("slot", activeSlot);
    if (activeZone) next.set("zone", activeZone);
    if (view !== "plan") next.set("view", view);
    const query = next.toString();
    if (query !== params.toString()) {
      // replace, not push: changing slot should not stack up history entries
      // somebody then has to press Back through.
      router.replace(`${pathname}?${query}`, { scroll: false });
    }
  }, [activeDate, activeSlot, activeZone, view, params, pathname, router]);

  const dates = useQuery({
    queryKey: ["floor", "dates"],
    queryFn: () => getJson<DatesPayload>("/api/floor/dates"),
  });

  // The first bookable day is chosen by the server from the shared Clock, not
  // by the browser's own Date.
  useEffect(() => {
    if (activeDate === null && dates.data?.days[0]) {
      setActiveDate(dates.data.days[0].date);
    }
  }, [activeDate, dates.data, setActiveDate]);

  const floor = useQuery({
    queryKey: ["floor", activeDate, activeSlot],
    queryFn: () => getJson<FloorPlanPayload>(`/api/floor?date=${activeDate}&slot=${activeSlot}`),
    enabled: activeDate !== null,
    // Seat availability changes under you as colleagues book, so this cannot
    // ride the app-wide 30s staleTime.
    staleTime: 5_000,
    refetchInterval: 30_000,
    placeholderData: (previous) => previous,
  });

  const seats = useMemo(() => floor.data?.seats ?? [], [floor.data]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const seat of seats) {
      if (activeZone !== null && seat.zone !== activeZone) continue;
      out[seat.status] = (out[seat.status] ?? 0) + 1;
    }
    return out;
  }, [seats, activeZone]);

  const visible = useMemo(
    () => (activeZone === null ? seats : seats.filter((s) => s.zone === activeZone)),
    [seats, activeZone],
  );

  const onActivateSeat = useCallback((seat: FloorPlanSeat) => {
    // Phase 3 wires the write path. For now this records the intent so the
    // flow can be walked end to end and the booking API has a caller waiting.
    console.info("[floor] booking intent", {
      seatCode: seat.seatCode,
      bay: seat.bay,
      zone: seat.zone,
      status: seat.status,
    });
    setIntent(seat);
  }, []);

  const slots = dates.data?.slots ?? [];
  const loading = dates.isLoading || (floor.isLoading && !floor.data);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs tracking-wide text-ink-subtle uppercase">
            Occupancy, this slot
          </p>
          {floor.data ? (
            <OccupancyCount
              occupied={floor.data.occupied}
              capacity={floor.data.capacity}
              reduceMotion={reduceMotion}
            />
          ) : (
            <div className="h-8 w-32 rounded-sm bg-surface-sunken" />
          )}
        </div>
        <ViewToggle view={view} onChange={setView} />
      </div>

      <Card>
        <CardBody className="space-y-4">
          {dates.data ? (
            <>
              <DateStrip
                days={dates.data.days}
                active={activeDate}
                onChange={setActiveDate}
              />
              <SlotToggle slots={slots} active={activeSlot} onChange={setActiveSlot} />
            </>
          ) : (
            <div className="h-20 rounded-sm bg-surface-sunken" />
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ZoneFilter active={activeZone} onChange={setActiveZone} />
            <Legend counts={counts} />
          </div>
        </CardBody>
      </Card>

      {floor.isError ? (
        <Card>
          <CardBody>
            <p className="text-sm text-danger">
              The floor could not be loaded. {String(floor.error)}
            </p>
          </CardBody>
        </Card>
      ) : loading ? (
        <div
          className="h-[clamp(26rem,70vh,50rem)] rounded-md border border-hairline bg-surface-sunken"
          role="status"
          aria-label="Loading the floor plan"
        />
      ) : (
        <FloorPlan
          seats={visible}
          mode="2d"
          view={view}
          activeZone={activeZone}
          focusedSeatCode={focusedSeatCode}
          crossfadeKey={`${activeDate}-${activeSlot}`}
          onFocusSeat={setFocusedSeatCode}
          onActivateSeat={onActivateSeat}
          className={view === "plan" ? "h-[clamp(26rem,70vh,50rem)] w-full" : undefined}
        />
      )}

      <BookingIntentDialog
        seat={intent}
        date={activeDate}
        slot={activeSlot}
        slotDefinition={slots.find((s) => s.key === activeSlot) ?? null}
        onClose={() => setIntent(null)}
      />
    </div>
  );
}
