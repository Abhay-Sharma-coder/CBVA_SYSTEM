"use client";

import { useSearchParams } from "next/navigation";

import { BarChart } from "@/components/analytics/charts/bar-chart";
import { seriesColors } from "@/components/analytics/charts/chart-frame";
import { FilterBar } from "@/components/analytics/filter-bar";
import { useForecast } from "@/components/analytics/use-analytics";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  StatusMessage,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetBoundary } from "@/components/ui/widget-boundary";
import { WEEKDAY_LABELS } from "@/lib/analytics/types";

/** Over this share of capacity and a day is worth a word to somebody. */
const BUSY = 0.9;
/** Under this and the floor is being paid for and not used. */
const QUIET = 0.35;

function weekdayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return WEEKDAY_LABELS[wd === 0 ? 7 : wd] ?? "";
}

/**
 * The next five working days.
 *
 * This is the thing CBVA said outright they have no way to see: whether
 * tomorrow is going to be full. The dates come from `bookableDates()` — the
 * same function the date strip renders and the write path enforces — so a
 * forecast never covers a day nobody can actually book.
 *
 * Over and under capacity are called out IN WORDS as well as in colour. A
 * partner reading this in greyscale, or printing it, gets the same warning.
 */
export function ForecastClient() {
  const params = useSearchParams();
  const { data, isPending, error } = useForecast(new URLSearchParams(params.toString()));

  if (error) {
    return (
      <StatusMessage tone="danger">
        The forecast could not be loaded. {(error as Error).message}
      </StatusMessage>
    );
  }

  if (isPending || !data) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading forecast">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const capBy = new Map(data.capacity.map((c) => [`${c.date}|${c.slot}`, c]));
  const rowBy = new Map(data.days.map((d) => [`${d.date}|${d.slot}`, d]));
  const slotKeys = data.slots.map((s) => s.key);
  const palette = seriesColors(slotKeys.length);

  const perDay = data.dates.map((date) => {
    const claimed = slotKeys.map((k) => rowBy.get(`${date}|${k}`)?.desksClaimed ?? 0);
    const capacity = slotKeys.map((k) => capBy.get(`${date}|${k}`)?.capacity ?? 0);
    const peak = Math.max(...claimed, 0);
    const peakCap = Math.max(...capacity, 1);
    return { date, claimed, capacity, peak, peakCap, share: peak / peakCap };
  });

  const busiest = perDay.filter((d) => d.share >= BUSY);
  const quietest = perDay.filter((d) => d.share <= QUIET);

  if (data.dates.length === 0) {
    return (
      <EmptyState title="No bookable days ahead">
        The booking window is closed, or every day in it is a weekend or a
        holiday. Check the window and the holiday list in Settings.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      <FilterBar
        slots={data.slots}
        showRange={false}
        showMeasure={false}
        showExport={false}
      />

      <WidgetBoundary title="Forecast summary">
        <Card>
          <CardHeader>
            <CardTitle>The next {data.dates.length} working days</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="max-w-3xl text-sm leading-relaxed text-ink">
              Bookings already made for each day ahead, against the desks that
              will be available. Numbers rise as the day approaches — most people
              book the evening before — so a quiet Thursday four days out is not
              yet evidence of a quiet Thursday.
            </p>

            {busiest.length > 0 ? (
              <StatusMessage tone="caution">
                <strong className="font-medium">
                  {busiest.map((d) => `${weekdayOf(d.date)} ${d.date}`).join(", ")}
                </strong>{" "}
                {busiest.length === 1 ? "is" : "are"} at or near capacity —{" "}
                {busiest.map((d) => `${d.peak} of ${d.peakCap}`).join(", ")}.
                Somebody arriving without a booking may not find a desk.
              </StatusMessage>
            ) : null}

            {quietest.length > 0 ? (
              <StatusMessage tone="neutral">
                <strong className="font-medium">
                  {quietest.map((d) => `${weekdayOf(d.date)} ${d.date}`).join(", ")}
                </strong>{" "}
                {quietest.length === 1 ? "is" : "are"} well under capacity, at
                most {Math.max(...quietest.map((d) => d.peak))} of{" "}
                {Math.max(...quietest.map((d) => d.peakCap))} desks. This is the
                pattern the desk count should be argued from.
              </StatusMessage>
            ) : null}

            {busiest.length === 0 && quietest.length === 0 ? (
              <StatusMessage tone="positive">
                Every day ahead is comfortably within capacity — between{" "}
                {Math.min(...perDay.map((d) => d.peak))} and{" "}
                {Math.max(...perDay.map((d) => d.peak))} desks against a pool of{" "}
                {perDay[0]?.peakCap}.
              </StatusMessage>
            ) : null}
          </CardBody>
        </Card>
      </WidgetBoundary>

      <WidgetBoundary title="Booked against capacity">
        <Card>
          <CardBody>
            <BarChart
              title="Booked against capacity, per slot"
              caption="The dashed rule on each day is the desks available in that slot. A bar reaching it means the floor is full."
              series={slotKeys.map((k, i) => ({
                key: k,
                label: data.slots.find((s) => s.key === k)?.label ?? k,
                color: palette[i % palette.length]!,
              }))}
              data={data.dates.map((date) => {
                const d = perDay.find((x) => x.date === date)!;
                return {
                  key: date,
                  label: `${weekdayOf(date)} ${date.slice(5)}`,
                  values: d.claimed,
                  reference: d.capacity[0] ?? null,
                };
              })}
              unit="desks"
              height={240}
            />
          </CardBody>
        </Card>
      </WidgetBoundary>

      <WidgetBoundary title="Day by day">
        <Card>
          <CardHeader>
            <CardTitle>Day by day</CardTitle>
          </CardHeader>
          <CardBody>
            <Table>
              <thead>
                <tr>
                  <Th>Day</Th>
                  {data.slots.map((s) => (
                    <Th key={s.key} numeric>
                      {s.label}
                    </Th>
                  ))}
                  <Th numeric>Capacity</Th>
                  <Th numeric>Peak use</Th>
                  <Th>Reading</Th>
                </tr>
              </thead>
              <tbody>
                {perDay.map((d) => (
                  <tr key={d.date}>
                    <Td className="font-medium">
                      {weekdayOf(d.date)} {d.date}
                    </Td>
                    {d.claimed.map((v, i) => (
                      <Td key={i} numeric>
                        {v}
                      </Td>
                    ))}
                    <Td numeric>{d.peakCap}</Td>
                    <Td numeric>{Math.round(d.share * 100)}%</Td>
                    {/* In words as well as in the number, so this survives a
                        greyscale print and a colour-vision deficiency. */}
                    <Td>
                      {d.share >= BUSY
                        ? "At capacity"
                        : d.share <= QUIET
                          ? "Well under"
                          : "Comfortable"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      </WidgetBoundary>
    </div>
  );
}
