"use client";

import { useQuery } from "@tanstack/react-query";

import type { MeasureKey } from "@/lib/analytics/measures";
import type {
  CapacityRow,
  DaySlotRow,
  DimensionRow,
  HeatCell,
  Headline,
  SeatUtilisationRow,
  WeekdayRow,
} from "@/lib/analytics/types";
import type { SlotDefinition } from "@/lib/slots";

/**
 * One fetch per screen, not one per panel.
 *
 * Everything on an analytics screen has to agree with everything else. Two
 * requests half a second apart, with a demo clock somebody may be advancing
 * mid-demo, is how a partner ends up looking at a headline and a chart that
 * cannot both be true — and the fix afterwards is never as convincing as never
 * having shown it.
 */
export interface Filters {
  from: string;
  to: string;
  zone: string | null;
  bay: string | null;
  team: string | null;
  slot: string | null;
  measure: MeasureKey;
}

export interface TrendsPayload {
  view: "trends";
  now: string;
  filters: Filters;
  slots: SlotDefinition[];
  workingDays: number;
  headline: Headline;
  days: DaySlotRow[];
  weekday: WeekdayRow[];
  byZone: DimensionRow[];
  byBay: DimensionRow[];
  byTeam: DimensionRow[];
  byStatus: DimensionRow[];
  byGrade: DimensionRow[];
  heat: HeatCell[];
  utilisation: SeatUtilisationRow[];
  capacity: CapacityRow[];
  options: {
    zones: Array<{ code: string; displayName: string }>;
    bays: string[];
    teams: string[];
  };
}

export interface TodayPayload {
  view: "today";
  now: string;
  today: string;
  isWorkingDay: boolean;
  slots: SlotDefinition[];
  filters: Filters;
  days: DaySlotRow[];
  capacity: CapacityRow[];
  byZone: DimensionRow[];
  byBay: DimensionRow[];
  byStatus: DimensionRow[];
}

export interface ForecastPayload {
  view: "forecast";
  now: string;
  dates: string[];
  slots: SlotDefinition[];
  filters: Filters;
  days: DaySlotRow[];
  capacity: CapacityRow[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function analyticsQuery(view: string, params: URLSearchParams) {
  const qs = new URLSearchParams(params);
  qs.set("view", view);
  return {
    queryKey: ["analytics", view, qs.toString()] as const,
    queryFn: () => getJson(`/api/admin/analytics?${qs.toString()}`),
  };
}

export function useTrends(params: URLSearchParams) {
  const q = analyticsQuery("trends", params);
  return useQuery({ ...q, queryFn: q.queryFn as () => Promise<TrendsPayload> });
}

export function useToday(params: URLSearchParams) {
  const q = analyticsQuery("today", params);
  return useQuery({
    ...q,
    queryFn: q.queryFn as () => Promise<TodayPayload>,
    // The live screen. Fifteen seconds matches the notification inbox, and it
    // is what makes a check-in during a demo appear without anybody reloading.
    refetchInterval: 15_000,
  });
}

export function useForecast(params: URLSearchParams) {
  const q = analyticsQuery("forecast", params);
  return useQuery({ ...q, queryFn: q.queryFn as () => Promise<ForecastPayload> });
}

/** The value a measure contributes, so one toggle re-reads every chart. */
export function measureValue(
  row: { desksClaimed: number; desksAttended: number; seatHours: number },
  measure: MeasureKey,
): number {
  if (measure === "attended") return row.desksAttended;
  if (measure === "seat_hours") return row.seatHours;
  return row.desksClaimed;
}

export function measureUnit(measure: MeasureKey): string {
  return measure === "seat_hours" ? "hours" : "desks";
}
