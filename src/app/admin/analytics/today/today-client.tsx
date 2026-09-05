"use client";

import { useSearchParams } from "next/navigation";

import { BarChart } from "@/components/analytics/charts/bar-chart";
import { seriesColors } from "@/components/analytics/charts/chart-frame";
import { FilterBar } from "@/components/analytics/filter-bar";
import { useToday } from "@/components/analytics/use-analytics";
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
import { Stat, StatRow } from "@/components/ui/stat";
import { WidgetBoundary } from "@/components/ui/widget-boundary";

/**
 * Live occupancy for the current date.
 *
 * "Current" means the DEMO CLOCK's current, not the server's — otherwise the
 * one screen somebody is watching while a colleague advances the clock two
 * hours is the one screen that does not move, which would undo the whole point
 * of the clock being shared.
 */
export function TodayClient() {
  const params = useSearchParams();
  const { data, isPending, error, dataUpdatedAt } = useToday(
    new URLSearchParams(params.toString()),
  );

  if (error) {
    return (
      <StatusMessage tone="danger">
        Live occupancy could not be loaded. {(error as Error).message}
      </StatusMessage>
    );
  }

  if (isPending || !data) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading live occupancy">
        <Skeleton className="h-28" />
        <Skeleton className="h-60" />
      </div>
    );
  }

  const capBy = new Map(data.capacity.map((c) => [c.slot, c]));
  const slotKeys = data.slots.map((s) => s.key);
  const palette = seriesColors(slotKeys.length);

  const totals = data.days.reduce(
    (a, d) => ({
      claimed: a.claimed + d.desksClaimed,
      attended: a.attended + d.desksAttended,
      released: a.released + d.autoReleased,
      noShow: a.noShow + d.noShows,
    }),
    { claimed: 0, attended: 0, released: 0, noShow: 0 },
  );

  const capacityTotal = data.slots.reduce(
    (n, s) => n + (capBy.get(s.key)?.capacity ?? 0),
    0,
  );
  const free = Math.max(0, capacityTotal - totals.claimed);

  if (!data.isWorkingDay || data.days.length === 0) {
    return (
      <div className="space-y-6">
        <FilterBar
          slots={data.slots}
          showRange={false}
          showMeasure={false}
          showExport={false}
        />
        <EmptyState
          title={
            data.isWorkingDay
              ? "Nothing booked for today yet"
              : "Today is not a working day"
          }
        >
          {data.isWorkingDay
            ? "The floor is entirely free. Bookings appear here the moment somebody makes one — this screen refreshes on its own."
            : "Weekends and the holidays in Settings are not bookable, so there is no occupancy to report."}
        </EmptyState>
      </div>
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

      <WidgetBoundary title="Live occupancy">
        <Card>
          <CardHeader>
            <CardTitle>
              Right now — {data.today}
              <span className="ms-2 text-xs font-normal text-ink-subtle">
                updates every 15 seconds
                <span className="sr-only">, automatically</span>
                {dataUpdatedAt
                  ? ` · last read ${new Date(dataUpdatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
                  : ""}
              </span>
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <StatRow>
              <Stat
                label="Desks claimed"
                value={totals.claimed}
                of={`of ${capacityTotal}`}
                accent
                hint="Across both slots. A full day counts twice, because it consumes two slots."
              />
              <Stat
                label="Checked in"
                value={totals.attended}
                hint="Evidence somebody is actually at the desk, by QR, badge or the app."
              />
              <Stat
                label="Auto released"
                value={totals.released}
                hint="Claimed, never checked into, and handed back by the two-hour rule."
              />
              <Stat
                label="Still free"
                value={free}
                hint="Bookable right now, including desks that came back late."
              />
            </StatRow>

            {totals.claimed > 0 && totals.attended === 0 ? (
              <StatusMessage tone="caution">
                Nothing has been checked into yet today. Until somebody scans a
                desk QR or badges in, every figure here is a claim on a desk
                rather than evidence one is in use.
              </StatusMessage>
            ) : null}
          </CardBody>
        </Card>
      </WidgetBoundary>

      <div className="grid gap-6 lg:grid-cols-2">
        <WidgetBoundary title="By slot">
          <Card>
            <CardBody>
              <BarChart
                title="By slot"
                caption="Claimed against the desks actually available in that slot — which includes any allocated desk whose owner handed it back for today."
                series={[
                  { key: "claimed", label: "Claimed", color: palette[0]! },
                  { key: "attended", label: "Checked in", color: palette[1]! },
                ]}
                data={data.slots.map((s) => {
                  const row = data.days.find((d) => d.slot === s.key);
                  return {
                    key: s.key,
                    label: s.label,
                    values: [row?.desksClaimed ?? 0, row?.desksAttended ?? 0],
                    reference: capBy.get(s.key)?.capacity ?? null,
                  };
                })}
                unit="desks"
                height={190}
              />
            </CardBody>
          </Card>
        </WidgetBoundary>

        <WidgetBoundary title="By zone">
          <Card>
            <CardBody>
              <BarChart
                title="By zone"
                caption="Where people are sitting today."
                series={[
                  { key: "claimed", label: "Claimed", color: palette[0]! },
                  { key: "attended", label: "Checked in", color: palette[1]! },
                ]}
                data={data.byZone.map((z) => ({
                  key: z.key,
                  label: `Zone ${z.key}`,
                  values: [z.desksClaimed, z.desksAttended],
                }))}
                unit="desks"
                height={190}
              />
            </CardBody>
          </Card>
        </WidgetBoundary>
      </div>

      <WidgetBoundary title="By bay">
        <Card>
          <CardHeader>
            <CardTitle>By bay</CardTitle>
          </CardHeader>
          <CardBody>
            <Table>
              <thead>
                <tr>
                  <Th>Bay</Th>
                  <Th numeric>Claimed</Th>
                  <Th numeric>Checked in</Th>
                  <Th numeric>Auto released</Th>
                  <Th numeric>No shows</Th>
                </tr>
              </thead>
              <tbody>
                {data.byBay.map((b) => (
                  <tr key={b.key}>
                    <Td className="seat-code font-medium">{b.key}</Td>
                    <Td numeric>{b.desksClaimed}</Td>
                    <Td numeric>{b.desksAttended}</Td>
                    <Td numeric>{b.autoReleased}</Td>
                    <Td numeric>{b.noShows}</Td>
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
