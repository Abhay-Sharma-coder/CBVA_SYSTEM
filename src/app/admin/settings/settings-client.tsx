"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";

import { ApiError, getJson, request } from "@/components/admin/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
  StatusMessage,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import type { SlotDefinition } from "@/lib/slots";

interface Settings {
  bookingWindowDays: number;
  bookingWindowWorkingDays: number;
  cutoffMinutes: number;
  autoReleaseMinutes: number;
  checkInOpensMinutesBefore: number;
  officeHours: { start: string; end: string };
  timezone: string;
  slotDefinitions: SlotDefinition[];
  autoReleaseBatchCap: number;
  autoReleaseHorizonDays: number;
}

interface Holiday {
  id: string;
  holidayDate: string;
  name: string;
}

/**
 * Every open question, as configuration.
 *
 * THE POINT OF THIS SCREEN: when CBVA answers one of the assumptions in
 * docs/OPEN-QUESTIONS.md, nobody should have to touch code. Slot boundaries
 * (A4), the booking window and cut-off (A5), the holiday list (A6), the
 * auto-release window and check-in opening (A5, A20) and the office hours the
 * room grid draws (A18) are all here.
 *
 * Editing slot definitions BACKFILLS every live booking's stored bounds in the
 * same transaction (ADR-021), and refuses a change that would strand a booking,
 * a recurring series or a released desk on a slot key that no longer exists.
 */
export function SettingsClient() {
  const qc = useQueryClient();
  const [notice, setNotice] = React.useState<{
    tone: "positive" | "danger" | "caution";
    text: string;
  } | null>(null);
  const [draft, setDraft] = React.useState<Partial<Settings>>({});
  const [slotDraft, setSlotDraft] = React.useState<SlotDefinition[] | null>(null);
  const [newHoliday, setNewHoliday] = React.useState({ holidayDate: "", name: "" });

  const settings = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => getJson<Settings>("/api/admin/settings"),
  });
  const holidays = useQuery({
    queryKey: ["admin", "holidays"],
    queryFn: () => getJson<{ holidays: Holiday[] }>("/api/admin/holidays"),
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request<{ backfilled: number }>("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (res) => {
      setNotice({
        tone: "positive",
        text:
          res.backfilled > 0
            ? `Saved. ${res.backfilled} booking${res.backfilled === 1 ? "" : "s"} had their start and end times recomputed to match.`
            : "Saved.",
      });
      setDraft({});
      setSlotDraft(null);
      void qc.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
    onError: (err: ApiError) => setNotice({ tone: "danger", text: err.message }),
  });

  const addHoliday = useMutation({
    mutationFn: (body: { holidayDate: string; name: string }) =>
      request("/api/admin/holidays", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      setNewHoliday({ holidayDate: "", name: "" });
      void qc.invalidateQueries({ queryKey: ["admin", "holidays"] });
    },
    onError: (err: ApiError) => setNotice({ tone: "danger", text: err.message }),
  });

  const removeHoliday = useMutation({
    mutationFn: (id: string) =>
      request("/api/admin/holidays", { method: "DELETE", body: JSON.stringify({ id }) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "holidays"] }),
    onError: (err: ApiError) => setNotice({ tone: "danger", text: err.message }),
  });

  if (settings.isPending || !settings.data) {
    return <Skeleton className="h-96" label="Loading settings" />;
  }

  const s = settings.data;
  const slots = slotDraft ?? s.slotDefinitions;
  const value = <K extends keyof Settings>(k: K): Settings[K] =>
    (draft[k] as Settings[K]) ?? s[k];

  const numberField = (
    k: keyof Settings,
    label: string,
    hint: string,
    props: { min?: number; max?: number } = {},
  ) => (
    <Field label={label} htmlFor={String(k)} hint={hint}>
      <Input
        id={String(k)}
        type="number"
        {...props}
        value={String(value(k))}
        onChange={(e) => setDraft((d) => ({ ...d, [k]: Number(e.target.value) }))}
      />
    </Field>
  );

  const dirty = Object.keys(draft).length > 0 || slotDraft !== null;

  return (
    <div className="space-y-6">
      {notice ? <StatusMessage tone={notice.tone}>{notice.text}</StatusMessage> : null}

      <Card>
        <CardHeader>
          <CardTitle>Booking rules</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {numberField(
            "bookingWindowWorkingDays",
            "Booking window (working days)",
            "How many working days ahead staff may book. Weekends and holidays are skipped, so five means five days somebody could actually come in.",
            { min: 1, max: 60 },
          )}
          {numberField(
            "bookingWindowDays",
            "Calendar-day ceiling",
            "The scan stops here, so an unusual run of holidays cannot walk the window forward indefinitely.",
            { min: 1, max: 90 },
          )}
          {numberField(
            "cutoffMinutes",
            "Cut-off (minutes)",
            "How close to a slot people may still edit or cancel. It does NOT stop somebody booking a desk mid-slot — that is how an auto-released desk gets used.",
            { min: 0, max: 1440 },
          )}
          {numberField(
            "autoReleaseMinutes",
            "Auto-release grace (minutes)",
            "How long a desk is held for somebody who has not checked in. Keep it well under a slot length: a grace window longer than the slot silently removes the feature.",
            { min: 5, max: 720 },
          )}
          {numberField(
            "checkInOpensMinutesBefore",
            "Check-in opens (minutes before)",
            "Somebody arriving early should be able to sit down and scan; somebody scanning at lunchtime should not accidentally check in to the afternoon.",
            { min: 0, max: 360 },
          )}
          <Field
            label="Timezone"
            htmlFor="timezone"
            hint="Changing this recomputes every live booking's start and end times, because 09:00 is not the same instant in two places."
          >
            <Input
              id="timezone"
              value={value("timezone")}
              onChange={(e) => setDraft((d) => ({ ...d, timezone: e.target.value }))}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Slots</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="max-w-3xl text-sm text-ink-muted">
            The slot vocabulary is data, not code. Moving CBVA to hourly booking
            is an edit here rather than a rebuild. Saving a change recomputes the
            stored start and end time of every live booking in the same
            transaction, and refuses outright if it would strand one on a slot
            that no longer exists.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>Key</Th>
                <Th>Label</Th>
                <Th>Start</Th>
                <Th>End</Th>
              </tr>
            </thead>
            <tbody>
              {slots.map((d, i) => (
                <tr key={d.key}>
                  <Td className="seat-code">{d.key}</Td>
                  {(["label", "start", "end"] as const).map((f) => (
                    <Td key={f}>
                      <Input
                        aria-label={`${d.key} ${f}`}
                        value={d[f]}
                        onChange={(e) =>
                          setSlotDraft(
                            slots.map((x, j) =>
                              j === i ? { ...x, [f]: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scheduled job bounds</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <StatusMessage tone="neutral">
            These exist because an unbounded auto-release once settled 577
            bookings in a single run and emptied the demo floor. The cap applies{" "}
            <strong className="font-medium">nothing</strong> when it trips, rather
            than a partial batch — a bound that only slows a runaway down is not
            a bound.
          </StatusMessage>
          <div className="grid gap-5 sm:grid-cols-2">
            {numberField(
              "autoReleaseBatchCap",
              "Batch cap",
              "Most bookings one transition may settle in one run. Roughly four times the bookable pool: a cron down for a whole day legitimately settles about two per desk.",
              { min: 1, max: 10000 },
            )}
            {numberField(
              "autoReleaseHorizonDays",
              "Horizon (days)",
              "Bookings older than this are left for a human to settle deliberately. They are counted and shown on the Jobs screen, never silently ignored.",
              { min: 1, max: 365 },
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Public holidays</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <StatusMessage tone="caution">
            The {holidays.data?.holidays.length ?? 0} dates below are{" "}
            <strong className="font-medium">ours, not CBVA&rsquo;s</strong> (open
            question A6). The lunar-calendar dates in particular vary by
            observance. A wrong date here means staff cannot book a day they are
            expected in — replace this list with the firm&rsquo;s official
            circular.
          </StatusMessage>

          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (newHoliday.holidayDate && newHoliday.name) addHoliday.mutate(newHoliday);
            }}
          >
            <Field label="Date" htmlFor="holiday-date">
              <Input
                id="holiday-date"
                type="date"
                value={newHoliday.holidayDate}
                onChange={(e) =>
                  setNewHoliday((h) => ({ ...h, holidayDate: e.target.value }))
                }
              />
            </Field>
            <Field label="Name" htmlFor="holiday-name">
              <Input
                id="holiday-name"
                value={newHoliday.name}
                onChange={(e) => setNewHoliday((h) => ({ ...h, name: e.target.value }))}
                placeholder="Diwali"
              />
            </Field>
            <Button type="submit" variant="secondary" disabled={addHoliday.isPending}>
              Add holiday
            </Button>
          </form>

          {holidays.isPending ? (
            <Skeleton className="h-40" label="Loading holidays" />
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Name</Th>
                    <Th>
                      <span className="sr-only">Remove</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {(holidays.data?.holidays ?? []).map((h) => (
                    <tr key={h.id}>
                      <Td className="tabular">{h.holidayDate}</Td>
                      <Td>{h.name}</Td>
                      <Td>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeHoliday.mutate(h.id)}
                          aria-label={`Remove ${h.name} on ${h.holidayDate}`}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Sticky, because the holiday list is long and the save button would
          otherwise be a scroll away from the field somebody just edited. */}
      <div className="sticky bottom-4 flex items-center gap-3 rounded-md border border-hairline bg-surface p-3 shadow-hairline">
        <Button
          variant="primary"
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate({
              ...draft,
              ...(slotDraft ? { slotDefinitions: slotDraft } : {}),
            })
          }
        >
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
        {dirty ? (
          <Button
            variant="ghost"
            onClick={() => {
              setDraft({});
              setSlotDraft(null);
            }}
          >
            Discard
          </Button>
        ) : null}
        <span className="text-xs text-ink-subtle">
          {dirty ? "Unsaved changes." : "Everything here is saved."}
        </span>
      </div>
    </div>
  );
}
