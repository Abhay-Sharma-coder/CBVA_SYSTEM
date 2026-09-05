"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, getJson, request } from "@/components/admin/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  StatusMessage,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatRow } from "@/components/ui/stat";

interface Preview {
  released: number;
  markedNoShow: number;
  completed: number;
  remindersQueued: number;
  capTripped: boolean;
  cappedTransitions: Array<{ transition: string; candidates: number; cap: number }>;
  beyondHorizon: number;
}

interface JobsPayload {
  now: string;
  settings: {
    autoReleaseMinutes: number;
    autoReleaseBatchCap: number;
    autoReleaseHorizonDays: number;
    demoOffsetSeconds: number;
  };
  preview: Preview;
  outbox: Record<string, number>;
  recent: Array<{ action: string; at: string; detail: unknown }>;
}

/**
 * What the scheduled jobs would do, and what they have been doing.
 *
 * THE DRY RUN IS THE POINT. A job that can rewrite thousands of rows of
 * attendance history should be inspectable before it is trusted, and "run it
 * and see" is not inspection — the 577-booking incident in Phase 3 was noticed
 * because the floor plan looked wrong afterwards, not because anything said so.
 */
export function JobsClient() {
  const qc = useQueryClient();
  const [result, setResult] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ["admin", "jobs"],
    queryFn: () => getJson<JobsPayload>("/api/admin/jobs"),
    refetchInterval: 30_000,
  });

  const run = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request<Record<string, unknown>>("/api/admin/jobs", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (res, vars) => {
      setError(null);
      setResult(
        `${vars.dryRun ? "Dry run" : "Run"} complete — ${JSON.stringify(res, null, 2)}`,
      );
      void qc.invalidateQueries({ queryKey: ["admin", "jobs"] });
    },
    onError: (err: ApiError) => {
      setResult(null);
      setError(err.message);
    },
  });

  if (isPending || !data) return <Skeleton className="h-96" label="Loading job status" />;

  const p = data.preview;

  return (
    <div className="space-y-6">
      {p.capTripped ? (
        <StatusMessage tone="danger">
          <strong className="font-medium">The batch cap has tripped.</strong>{" "}
          {p.cappedTransitions
            .map(
              (t) =>
                `${t.transition} matched ${t.candidates} bookings against a cap of ${t.cap}`,
            )
            .join("; ")}
          . Nothing was applied — deliberately, because a cap that lets a runaway
          through in instalments is not a bound. Check the clock before raising
          it: the demo offset is currently{" "}
          {Math.round(data.settings.demoOffsetSeconds / 3600)} hours.
        </StatusMessage>
      ) : null}

      {p.beyondHorizon > 0 ? (
        <StatusMessage tone="caution">
          {p.beyondHorizon} booking{p.beyondHorizon === 1 ? "" : "s"} ended more
          than {data.settings.autoReleaseHorizonDays} days ago and are still
          unsettled. The horizon leaves them alone on purpose — settle them
          deliberately below once you are satisfied the dates are real.
        </StatusMessage>
      ) : null}

      {error ? <StatusMessage tone="danger">{error}</StatusMessage> : null}

      <Card>
        <CardHeader>
          <CardTitle>
            What the next run would do
            <span className="ms-2 text-xs font-normal text-ink-subtle">
              a dry run, computed now — nothing has been changed
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <StatRow>
            <Stat
              label="Would auto-release"
              value={p.released}
              hint={`Confirmed, ${data.settings.autoReleaseMinutes} minutes past the start, nobody checked in, slot still running.`}
            />
            <Stat
              label="Would mark no-show"
              value={p.markedNoShow}
              hint="Slot finished with no check-in. Nothing left to hand back."
            />
            <Stat label="Would complete" value={p.completed} hint="Checked in, slot finished." />
            <Stat
              label="Reminders due"
              value={p.remindersQueued}
              hint="Sent halfway through the grace window, before anything is taken away."
            />
          </StatRow>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={run.isPending}
              onClick={() => run.mutate({ dryRun: true })}
            >
              Dry run
            </Button>
            <Button
              variant="primary"
              disabled={run.isPending}
              onClick={() => run.mutate({ dryRun: false })}
            >
              Run the jobs now
            </Button>
            {p.beyondHorizon > 0 ? (
              <Button
                variant="danger"
                disabled={run.isPending}
                onClick={() => run.mutate({ settleBacklog: true, dryRun: false })}
              >
                Settle the {p.beyondHorizon} beyond the horizon
              </Button>
            ) : null}
          </div>

          {result ? (
            <pre className="max-h-72 overflow-auto rounded-md border border-hairline bg-surface-sunken p-3 text-xs whitespace-pre-wrap text-ink-muted">
              {result}
            </pre>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Outbox</CardTitle>
        </CardHeader>
        <CardBody>
          <StatRow columns={3}>
            {Object.entries(data.outbox).map(([k, v]) => (
              <Stat key={k} label={k} value={v} />
            ))}
          </StatRow>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent job activity</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-3 text-sm text-ink-muted">
            Straight from the audit log, filtered to entries with no human actor
            — which is exactly what &ldquo;the job did this&rdquo; means here.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Action</Th>
                <Th>Detail</Th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((r, i) => (
                <tr key={i}>
                  <Td className="tabular whitespace-nowrap">
                    {new Date(r.at).toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </Td>
                  <Td className="font-medium">{r.action}</Td>
                  <Td className="text-xs text-ink-muted">
                    {r.detail ? JSON.stringify(r.detail) : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
