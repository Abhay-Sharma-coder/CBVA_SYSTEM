"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, DoorOpen, Repeat } from "lucide-react";

import { ApiError, getJson, request } from "@/components/admin/api";
import { useSession } from "@/components/app-shell/session";
import { Button } from "@/components/ui/button";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Select,
  StatusMessage,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import type { BookableDay } from "@/components/floor-plan/types";

interface Release {
  id: string;
  seatCode: string;
  zone: string;
  releaseDate: string;
  slot: string;
  takenBy: { bookingId: string; occupantName: string; status: string } | null;
}

interface SeriesRow {
  id: string;
  seatCode: string;
  zone: string;
  slot: string;
  weekdays: number[];
  startsOn: string;
  endsOn: string | null;
  status: string;
  occupantName: string;
  upcoming: Array<{ bookingDate: string; status: string }>;
}

interface Payload {
  now: string;
  series: SeriesRow[];
  releases: Release[];
}

interface DatesPayload {
  days: BookableDay[];
  slots: Array<{ key: string; label: string }>;
}

const WD = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Two features that exist to counter the same risk, on one panel.
 *
 * RELEASING AN ALLOCATED DESK is the only route by which any of the 47 fixed
 * desks ever appears in the occupancy data. A partner working from home on
 * Thursday is currently invisible to the analytics — their desk simply sits
 * there, counted as neither used nor free — and one click turns that into both
 * a measurement and a desk somebody else can have.
 *
 * A RECURRING BOOKING removes the main reason a low-contention floor stops
 * getting booked at all: if you come in the same three days every week and
 * always get a desk, the daily booking is friction with no visible benefit, and
 * people stop. If they stop, the occupancy data is worthless.
 */
export function MyDeskPanel({ fixedSeatCode }: { fixedSeatCode: string | null }) {
  const qc = useQueryClient();
  const session = useSession();
  const [notice, setNotice] = React.useState<{
    tone: "positive" | "danger" | "caution";
    text: string;
  } | null>(null);
  const [releaseDate, setReleaseDate] = React.useState("");

  const mine = useQuery({
    queryKey: ["series", "mine"],
    queryFn: () => getJson<Payload>("/api/series"),
  });
  const dates = useQuery({
    queryKey: ["floor", "dates"],
    queryFn: () => getJson<DatesPayload>("/api/floor/dates"),
  });

  const release = useMutation({
    mutationFn: (vars: { seatCode: string; date: string }) =>
      request(`/api/seats/${vars.seatCode}/release`, {
        method: "POST",
        body: JSON.stringify({ dates: [vars.date] }),
      }),
    onSuccess: (_d, vars) => {
      setNotice({
        tone: "positive",
        text: `${vars.seatCode} is back in the pool for ${vars.date}. It now counts towards the floor's capacity for that day.`,
      });
      void qc.invalidateQueries({ queryKey: ["series", "mine"] });
    },
    onError: (err: ApiError) => setNotice({ tone: "danger", text: err.message }),
  });

  const reclaim = useMutation({
    mutationFn: (vars: { seatCode: string; releaseId: string }) =>
      request(`/api/seats/${vars.seatCode}/release`, {
        method: "DELETE",
        body: JSON.stringify({ releaseId: vars.releaseId }),
      }),
    onSuccess: () => {
      setNotice({ tone: "positive", text: "Your desk is yours again." });
      void qc.invalidateQueries({ queryKey: ["series", "mine"] });
    },
    onError: (err: ApiError) =>
      setNotice({
        // The refusal names who has it, which is the whole reason it refuses
        // rather than silently unseating somebody.
        tone: err.code === "SEAT_RELEASE_TAKEN" ? "caution" : "danger",
        text: err.message,
      }),
  });

  const endSeries = useMutation({
    mutationFn: (vars: { id: string; cancelFuture: boolean }) =>
      request(`/api/series/${vars.id}`, {
        method: "DELETE",
        body: JSON.stringify({ cancelFutureOccurrences: vars.cancelFuture }),
      }),
    onSuccess: (_d, vars) => {
      setNotice({
        tone: "positive",
        text: vars.cancelFuture
          ? "The repeat is off and the desks you had booked have been given back."
          : "The repeat is off. The desks you already have are still yours.",
      });
      void qc.invalidateQueries({ queryKey: ["series", "mine"] });
      void qc.invalidateQueries({ queryKey: ["bookings", "mine"] });
    },
    onError: (err: ApiError) => setNotice({ tone: "danger", text: err.message }),
  });

  if (mine.isPending) return <Skeleton className="h-56" label="Loading your desk settings" />;

  const releases = mine.data?.releases ?? [];
  const series = mine.data?.series ?? [];
  const days = dates.data?.days ?? [];
  const releasedDates = new Set(releases.map((r) => r.releaseDate));
  const available = days.filter((d) => !releasedDates.has(d.date));

  const isFixed = session.data?.user?.seatMode === "fixed";

  return (
    <div className="space-y-6">
      {notice ? <StatusMessage tone={notice.tone}>{notice.text}</StatusMessage> : null}

      {isFixed && fixedSeatCode ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DoorOpen className="size-4 text-ink-subtle" aria-hidden="true" />
              Your desk — <span className="seat-code">{fixedSeatCode}</span>
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="max-w-2xl text-sm text-ink-muted">
              Working from home? Hand {fixedSeatCode} back for the day and
              somebody else can use it. It also means the desk appears in the
              occupancy figures — an allocated desk sitting empty is currently
              counted as neither used nor free.
            </p>

            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs">
                <span className="mb-1 block font-medium text-ink-subtle">
                  Release it for
                </span>
                <Select
                  className="w-56"
                  value={releaseDate}
                  onChange={(e) => setReleaseDate(e.target.value)}
                >
                  <option value="">Pick a day…</option>
                  {available.map((d) => (
                    <option key={d.date} value={d.date}>
                      {d.weekdayLabel} {d.dayLabel} {d.monthLabel}
                      {d.isToday ? " — today" : ""}
                    </option>
                  ))}
                </Select>
              </label>
              <Button
                variant="secondary"
                disabled={!releaseDate || release.isPending}
                onClick={() =>
                  release.mutate({ seatCode: fixedSeatCode, date: releaseDate })
                }
              >
                Release for that day
              </Button>
            </div>

            {releases.length === 0 ? (
              <p className="text-xs text-ink-subtle">
                You have not released your desk on any upcoming day.
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Day</Th>
                    <Th>Slot</Th>
                    <Th>Taken by</Th>
                    <Th>
                      <span className="sr-only">Reclaim</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {releases.map((r) => (
                    <tr key={r.id}>
                      <Td className="tabular">{r.releaseDate}</Td>
                      <Td>{r.slot}</Td>
                      <Td>
                        {r.takenBy ? (
                          <Badge variant="navy">{r.takenBy.occupantName}</Badge>
                        ) : (
                          <span className="text-ink-subtle">still free</span>
                        )}
                      </Td>
                      <Td>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={reclaim.isPending}
                          onClick={() =>
                            reclaim.mutate({
                              seatCode: r.seatCode,
                              releaseId: r.id,
                            })
                          }
                        >
                          Take it back
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Repeat className="size-4 text-ink-subtle" aria-hidden="true" />
            Recurring bookings
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {series.length === 0 ? (
            <EmptyState title="No repeating bookings">
              If you come in on the same days every week, set a desk to repeat
              from the booking dialog on the floor plan. It books itself as each
              new day comes into the five-day window.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Desk</Th>
                  <Th>Days</Th>
                  <Th>Slot</Th>
                  <Th>Booked ahead</Th>
                  <Th>
                    <span className="sr-only">Stop</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {series.map((s) => (
                  <tr key={s.id}>
                    <Td className="seat-code font-medium">{s.seatCode}</Td>
                    <Td>{s.weekdays.map((w) => WD[w]).join(", ")}</Td>
                    <Td>{s.slot}</Td>
                    <Td className="tabular">
                      {s.upcoming.length === 0 ? (
                        <span className="text-ink-subtle">none yet</span>
                      ) : (
                        `${s.upcoming.length} day${s.upcoming.length === 1 ? "" : "s"}`
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={endSeries.isPending}
                          onClick={() => endSeries.mutate({ id: s.id, cancelFuture: false })}
                        >
                          Stop repeating
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={endSeries.isPending}
                          onClick={() => endSeries.mutate({ id: s.id, cancelFuture: true })}
                        >
                          Stop and give the desks back
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          <p className="flex items-start gap-2 text-xs text-ink-subtle">
            <CalendarRange className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              A repeat books each day as it enters the five working-day window,
              not months in advance. If somebody takes the desk first on one of
              those days you get an email about that day only — the rest of the
              series is unaffected.
            </span>
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
