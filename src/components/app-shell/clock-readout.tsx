"use client";

import { useClock, useShiftClock } from "@/components/app-shell/session";
import { APP_TIMEZONE } from "@/lib/config";
import { Badge } from "@/components/ui/primitives";

const formatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: APP_TIMEZONE,
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * Shows the SHARED clock, not the browser's. When the demo clock is offset the
 * badge says so, because a screenshot of an office booking tool showing the
 * wrong time is otherwise indistinguishable from a bug.
 */
export function ClockReadout() {
  const { data } = useClock();
  const shift = useShiftClock();

  if (!data) {
    return <div className="h-5 w-36 rounded-sm bg-surface-sunken" aria-hidden="true" />;
  }

  const offset = data.offsetSeconds;
  const shifted = offset !== 0;
  const hours = Math.round(offset / 3600);

  return (
    <div className="flex items-center gap-2">
      {/* suppressHydrationWarning: the server and client render this at
          different instants; the value comes from /api/clock either way. */}
      <time
        dateTime={data.now}
        suppressHydrationWarning
        className="hidden text-xs tracking-tight text-ink-muted tabular sm:inline"
      >
        {formatter.format(new Date(data.now))} IST
      </time>

      {shifted ? (
        <>
          <Badge variant="gold" title={`Demo clock is ${hours > 0 ? "+" : ""}${hours}h from real time`}>
            Clock {hours > 0 ? "+" : ""}
            {hours}h
          </Badge>
          <button
            type="button"
            onClick={() => shift.mutate({ action: "reset" })}
            className="rounded-sm px-1.5 py-0.5 text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
          >
            Reset
          </button>
        </>
      ) : null}
    </div>
  );
}
