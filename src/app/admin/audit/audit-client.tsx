"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { getJson } from "@/components/admin/api";
import { Button } from "@/components/ui/button";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Select,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";

interface AuditRow {
  id: string;
  entity: string;
  entityId: string | null;
  action: string;
  before: unknown;
  after: unknown;
  at: string;
  actorName: string | null;
  actorEmail: string | null;
}

const PAGE = 50;

/**
 * The audit log, finally readable.
 *
 * `src/lib/audit.ts` has been writing this table since Phase 3 and nothing has
 * ever read it, which meant the RECORD existed but the accountability did not.
 * Every booking, cancellation, forced seat change, settings edit and job
 * transition is here.
 *
 * A null actor is the JOB, and it is labelled as such rather than left blank —
 * the scheduled jobs are the single largest writer to this table, and a screen
 * full of empty "who" cells would read as broken.
 */
export function AuditClient() {
  const [entity, setEntity] = React.useState("");
  const [action, setAction] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (entity) params.set("entity", entity);
  if (action) params.set("action", action);

  const { data, isPending } = useQuery({
    queryKey: ["admin", "audit", params.toString()],
    queryFn: () =>
      getJson<{
        rows: AuditRow[];
        total: number;
        entities: string[];
        actions: string[];
      }>(`/api/admin/audit?${params}`),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-end gap-3">
        <CardTitle className="me-auto">
          Audit log
          <span className="ms-2 text-xs font-normal text-ink-subtle tabular">
            {total.toLocaleString("en-IN")} entries
          </span>
        </CardTitle>
        <label className="text-xs">
          <span className="mb-1 block font-medium text-ink-subtle">Entity</span>
          <Select
            className="w-44"
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Everything</option>
            {(data?.entities ?? []).map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium text-ink-subtle">Action</span>
          <Select
            className="w-48"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Every action</option>
            {(data?.actions ?? []).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </label>
      </CardHeader>

      <CardBody className="space-y-4">
        {isPending ? (
          <TableSkeleton label="Loading audit log" rows={10} />
        ) : rows.length === 0 ? (
          <EmptyState title="Nothing recorded yet">
            The audit log fills as people book, cancel and edit, and as the
            scheduled jobs settle bookings. On a freshly seeded database it
            starts here.
          </EmptyState>
        ) : (
          <>
            <Table className="rows-lazy">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Who</Th>
                  <Th>Entity</Th>
                  <Th>Action</Th>
                  <Th>
                    <span className="sr-only">Detail</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <React.Fragment key={r.id}>
                    <tr>
                      <Td className="tabular whitespace-nowrap">
                        {new Date(r.at).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </Td>
                      <Td>
                        {r.actorName ?? (
                          // Not "unknown" — a null actor is the scheduled job,
                          // and it is the biggest writer here by far.
                          <Badge variant="neutral">Scheduled job</Badge>
                        )}
                      </Td>
                      <Td className="text-ink-muted">{r.entity}</Td>
                      <Td className="font-medium">{r.action}</Td>
                      <Td>
                        {r.before || r.after ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-expanded={expanded === r.id}
                            onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                          >
                            {expanded === r.id ? "Hide" : "Detail"}
                          </Button>
                        ) : null}
                      </Td>
                    </tr>
                    {expanded === r.id ? (
                      <tr>
                        <Td colSpan={5} className="bg-surface-sunken">
                          <div className="grid gap-4 sm:grid-cols-2">
                            {(["before", "after"] as const).map((k) =>
                              r[k] ? (
                                <div key={k}>
                                  <h4 className="text-[11px] font-medium tracking-wide text-ink-subtle uppercase">
                                    {k}
                                  </h4>
                                  <pre className="mt-1 overflow-x-auto text-xs whitespace-pre-wrap text-ink-muted">
                                    {JSON.stringify(r[k], null, 2)}
                                  </pre>
                                </div>
                              ) : null,
                            )}
                          </div>
                        </Td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                ))}
              </tbody>
            </Table>

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-ink-subtle tabular">
                {offset + 1}–{Math.min(offset + PAGE, total)} of{" "}
                {total.toLocaleString("en-IN")}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}
                >
                  Newer
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={offset + PAGE >= total}
                  onClick={() => setOffset(offset + PAGE)}
                >
                  Older
                </Button>
              </div>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
