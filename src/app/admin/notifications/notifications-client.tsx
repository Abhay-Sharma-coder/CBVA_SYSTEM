"use client";

/**
 * The demo inbox.
 *
 * Every notification this product has produced, rendered exactly as it would
 * have been sent. This is what makes the email flow demonstrable with no SMTP,
 * no tenant and no consent grant — and it is not a mock-up of the emails, it is
 * the emails: the same HTML `MailProvider` would hand to Graph, stored on the
 * row at enqueue time.
 *
 * The preview is an iframe with `srcDoc` and a locked-down sandbox. Injecting
 * stored HTML into this page would let a template's markup fight the app's own
 * styles — and email HTML is table-soup with inline styles, so it would.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatInTimeZone } from "date-fns-tz";

import { NOTIFICATION_LABELS, NOTIFICATION_KINDS } from "@/lib/notifications/kinds";
import { Button } from "@/components/ui/button";
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  Field,
  Select,
  StatusMessage,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const TZ = "Asia/Kolkata";

interface Message {
  id: string;
  kind: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: "queued" | "sent" | "failed";
  attempts: number;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  nextAttemptAt: string | null;
  bookingId: string | null;
  roomBookingId: string | null;
}

interface Payload {
  counts: Record<string, number>;
  messages: Message[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request to ${url} failed with ${res.status}`);
  return res.json() as Promise<T>;
}

const STATUS_VARIANT: Record<string, "neutral" | "positive" | "caution" | "danger"> = {
  sent: "positive",
  queued: "caution",
  failed: "danger",
};

export function NotificationsClient() {
  const qc = useQueryClient();
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["notifications", kind, status],
    queryFn: () => {
      const params = new URLSearchParams();
      if (kind) params.set("kind", kind);
      if (status) params.set("status", status);
      return getJson<Payload>(`/api/notifications?${params}`);
    },
    refetchInterval: 15_000,
  });

  const retry = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/notifications/${id}/retry`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not retry.");
      return body as { sent: number };
    },
    onSuccess: async (result) => {
      setMessage(result.sent > 0 ? "Sent on retry." : "Requeued — it will go out on the next run.");
      await qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (err) => setMessage(err.message),
  });

  const messages = useMemo(() => query.data?.messages ?? [], [query.data]);
  const selected = useMemo(
    () => messages.find((m) => m.id === selectedId) ?? messages[0] ?? null,
    [messages, selectedId],
  );

  const counts = query.data?.counts ?? {};

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="flex flex-wrap items-end gap-4">
          <Field label="Kind" htmlFor="filter-kind" className="w-56">
            <Select id="filter-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All kinds</option>
              {NOTIFICATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {NOTIFICATION_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="filter-status" className="w-40">
            <Select id="filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="queued">Queued</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
            </Select>
          </Field>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <Badge variant="positive">{counts.sent ?? 0} sent</Badge>
            <Badge variant="caution">{counts.queued ?? 0} queued</Badge>
            <Badge variant="danger">{counts.failed ?? 0} failed</Badge>
          </div>
        </CardBody>
      </Card>

      {message ? <StatusMessage tone="neutral">{message}</StatusMessage> : null}

      {query.isLoading ? (
        <div className="h-96 rounded-md border border-hairline bg-surface-sunken" role="status" aria-label="Loading the outbox" />
      ) : messages.length === 0 ? (
        <EmptyState title="Nothing in the outbox">
          Book a desk or a room and the confirmation will land here.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
          <Card className="overflow-hidden">
            <ul className="max-h-[36rem] divide-y divide-hairline overflow-y-auto">
              {messages.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(m.id)}
                    aria-current={selected?.id === m.id}
                    className={cn(
                      "w-full px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy",
                      selected?.id === m.id ? "bg-navy-tint" : "hover:bg-surface-sunken",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-ink-subtle">{m.recipientEmail}</span>
                      <Badge variant={STATUS_VARIANT[m.status] ?? "neutral"}>{m.status}</Badge>
                    </span>
                    <span className="mt-1 block truncate text-sm text-ink">{m.subject}</span>
                    <span className="mt-0.5 block text-[11px] text-ink-subtle tabular">
                      {formatInTimeZone(new Date(m.createdAt), TZ, "d MMM HH:mm")}
                      {m.attempts > 0 ? ` · ${m.attempts} attempt${m.attempts === 1 ? "" : "s"}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {selected ? (
            <Card>
              <CardBody className="space-y-3">
                <div>
                  <p className="font-title text-lg text-ink">{selected.subject}</p>
                  <p className="mt-1 text-xs text-ink-subtle">
                    {NOTIFICATION_LABELS[selected.kind as keyof typeof NOTIFICATION_LABELS] ??
                      selected.kind}{" "}
                    · to {selected.recipientEmail}
                    {selected.sentAt
                      ? ` · sent ${formatInTimeZone(new Date(selected.sentAt), TZ, "d MMM HH:mm")}`
                      : selected.nextAttemptAt
                        ? ` · next attempt ${formatInTimeZone(new Date(selected.nextAttemptAt), TZ, "d MMM HH:mm")}`
                        : " · waiting to send"}
                  </p>
                </div>

                {selected.error ? (
                  <StatusMessage tone="danger">
                    {selected.error} — {selected.attempts} attempt
                    {selected.attempts === 1 ? "" : "s"} so far.
                  </StatusMessage>
                ) : null}

                {selected.status === "failed" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => retry.mutate(selected.id)}
                    disabled={retry.isPending}
                  >
                    {retry.isPending ? "Retrying…" : "Retry now"}
                  </Button>
                ) : null}

                <iframe
                  title={`Preview of “${selected.subject}”`}
                  srcDoc={selected.body}
                  sandbox=""
                  className="h-[28rem] w-full rounded-sm border border-hairline bg-white"
                />
              </CardBody>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
