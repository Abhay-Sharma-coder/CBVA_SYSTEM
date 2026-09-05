"use client";

/**
 * Every demo affordance, in one panel, clearly labelled as such.
 *
 * Deliberately NOT scattered inline on booking cards. A "simulate badge swipe"
 * button next to a real Cancel button teaches a partner watching a demo that
 * the product has fake controls in it, and the next question is which of the
 * other buttons are also pretend. Corralling them here says the opposite: the
 * booking screens are the product, and this drawer is the rig the product is
 * being demonstrated on.
 *
 * What it does is real. Advancing the clock shifts `settings.demo_offset_seconds`,
 * which the server reads through `getClock()` — so the REAL auto-release job
 * runs the REAL rule against REAL rows and really releases a desk. The demo
 * proves production behaviour rather than imitating it.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { FlaskConical, X } from "lucide-react";

import { useClock, useSession, useShiftClock } from "@/components/app-shell/session";
import { Button } from "@/components/ui/button";
import { Select, StatusMessage } from "@/components/ui/primitives";
import { useUiStore } from "@/lib/store/ui";

const TZ = "Asia/Kolkata";

interface BadgeOutcome {
  matched: boolean;
  seatCode?: string;
  message: string;
}

interface JobResult {
  autoRelease: { released: number; markedNoShow: number; completed: number };
  notifications: { sent: number; failed: number };
  calendar: { synced: number; stillFailing: number };
}

export function DemoPanel() {
  const session = useSession();
  const clock = useClock();
  const shift = useShiftClock();
  const qc = useQueryClient();
  const router = useRouter();
  const { demoPanelOpen, toggleDemoPanel } = useUiStore();

  const [swipeFor, setSwipeFor] = useState("");
  const [message, setMessage] = useState<{ tone: "positive" | "danger" | "neutral"; text: string } | null>(null);

  const swipe = useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch("/api/demo/badge-swipe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(email ? { email } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The swipe could not be recorded.");
      return body as BadgeOutcome;
    },
    onSuccess: async (outcome) => {
      setMessage({ tone: outcome.matched ? "positive" : "neutral", text: outcome.message });
      await qc.invalidateQueries();
      router.refresh();
    },
    onError: (err) => setMessage({ tone: "danger", text: err.message }),
  });

  const runJobs = useMutation({
    mutationFn: async () => {
      // The ADMIN route, not the cron one. /api/cron/jobs is for the
      // scheduler and requires the shared secret whenever one is configured —
      // on a public demo URL an "admin session" is not a gate, because the demo
      // AuthProvider resolves an unknown visitor to a seeded admin.
      const res = await fetch("/api/admin/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The jobs could not be run.");
      return body as JobResult;
    },
    onSuccess: async (result) => {
      const { released, markedNoShow, completed } = result.autoRelease;
      setMessage({
        tone: released > 0 ? "positive" : "neutral",
        text:
          released + markedNoShow + completed === 0 && result.notifications.sent === 0
            ? "Nothing was due. Advance the clock past a booking's grace window and run it again."
            : `Released ${released} · no-show ${markedNoShow} · completed ${completed} · sent ${result.notifications.sent} email${
                result.notifications.sent === 1 ? "" : "s"
              }.`,
      });
      await qc.invalidateQueries();
      router.refresh();
    },
    onError: (err) => setMessage({ tone: "danger", text: err.message }),
  });

  // Nothing here exists in production. This reads a field on the session
  // payload rather than APP_MODE — the env var is branched on in exactly one
  // file (src/lib/adapters/index.ts) and this is not it.
  if (session.data?.appMode !== "demo") return null;

  const offset = clock.data?.offsetSeconds ?? 0;
  const busy = shift.isPending || swipe.isPending || runJobs.isPending;

  if (!demoPanelOpen) {
    return (
      <button
        type="button"
        onClick={toggleDemoPanel}
        className="print:hidden fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-sm border border-hairline bg-surface px-3 py-2 text-xs text-ink-muted shadow-hairline hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
      >
        <FlaskConical className="size-3.5" aria-hidden="true" />
        Demo controls
        {offset !== 0 ? (
          <span className="tabular text-caution">+{Math.round(offset / 3600)}h</span>
        ) : null}
      </button>
    );
  }

  return (
    <aside
      aria-label="Demo controls"
      className="print:hidden fixed right-4 bottom-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-md border border-hairline bg-surface shadow-hairline"
    >
      <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
            <FlaskConical className="size-3.5" aria-hidden="true" />
            Demo controls
          </p>
          <p className="mt-0.5 text-[11px] text-ink-subtle">
            Not part of the product. These drive real jobs against real rows.
          </p>
        </div>
        <button
          type="button"
          onClick={toggleDemoPanel}
          aria-label="Hide the demo controls"
          className="rounded-sm p-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-4 px-4 py-3">
        <section className="space-y-2">
          <p className="text-xs font-medium text-ink">The shared clock</p>
          <p className="text-[11px] text-ink-subtle">
            {clock.data ? (
              <>
                Now{" "}
                <span className="tabular text-ink">
                  {formatInTimeZone(new Date(clock.data.now), TZ, "EEE d MMM HH:mm")}
                </span>
                {offset !== 0 ? (
                  <span className="text-caution"> · offset {Math.round(offset / 60)} min</span>
                ) : null}
              </>
            ) : (
              "…"
            )}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[15, 60, 120].map((minutes) => (
              <Button
                key={minutes}
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => shift.mutate({ action: "advance", seconds: minutes * 60 })}
              >
                +{minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || offset === 0}
              onClick={() => shift.mutate({ action: "reset" })}
            >
              Reset
            </Button>
          </div>
        </section>

        <section className="space-y-2 border-t border-hairline pt-3">
          <p className="text-xs font-medium text-ink">Badge reader</p>
          <p className="text-[11px] text-ink-subtle">
            Writes a real badge_events row and pushes it through the same
            CheckInSource subscription a vendor webhook will.
          </p>
          <Select
            aria-label="Swipe as"
            value={swipeFor}
            disabled={busy}
            onChange={(e) => setSwipeFor(e.target.value)}
          >
            <option value="">Whoever is signed in</option>
            {(session.data?.roles ?? []).map((role) => (
              <option key={role.email} value={role.email}>
                {role.displayName}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              // An empty value means "whoever is signed in", which the route
              // resolves from the session rather than trusting the client.
              setMessage(null);
              swipe.mutate(swipeFor);
            }}
          >
            {swipe.isPending ? "Swiping…" : "Simulate badge swipe"}
          </Button>
        </section>

        <section className="space-y-2 border-t border-hairline pt-3">
          <p className="text-xs font-medium text-ink">Scheduled jobs</p>
          <p className="text-[11px] text-ink-subtle">
            Auto-release, the notification queue and calendar retries. Runs every
            60 seconds by itself; this makes it immediate.
          </p>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => runJobs.mutate()}>
            {runJobs.isPending ? "Running…" : "Run jobs now"}
          </Button>
        </section>

        <section className="flex gap-4 border-t border-hairline pt-3 text-[11px]">
          <a href="/admin/notifications" className="text-navy underline underline-offset-4 hover:text-ink">
            Inbox
          </a>
          <a href="/admin/qr" className="text-navy underline underline-offset-4 hover:text-ink">
            Desk QR codes
          </a>
        </section>

        {message ? (
          <StatusMessage tone={message.tone} className="text-[11px]">
            {message.text}
          </StatusMessage>
        ) : null}
      </div>
    </aside>
  );
}
