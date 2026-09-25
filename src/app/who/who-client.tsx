"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { getJson } from "@/components/admin/api";
import { useSession } from "@/components/app-shell/session";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Select,
  StatusMessage,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";
import { Stat, StatRow } from "@/components/ui/stat";
import type { BookableDay } from "@/components/floor-plan/types";

interface Person {
  id: string;
  displayName: string;
  team: string | null;
  grade: string;
  seatCode: string | null;
  bay: string | null;
  zone: string | null;
  slots: string[];
  checkedIn: boolean;
  fixedDesk: boolean;
  shared: boolean;
}

interface Payload {
  date: string;
  total: number;
  hidden: number;
  checkedIn: number;
  people: Person[];
}

interface DatesPayload {
  days: BookableDay[];
  slots: Array<{ key: string; label: string }>;
}

/**
 * Who is in, and where they are sitting.
 *
 * WHY THIS IS IN THE PRODUCT AT ALL. The risk on this engagement is not that
 * the booking flow is hard — it is that seat contention is low enough that
 * people do not bother booking, and occupancy data nobody generates is worth
 * nothing. Every product review in this category says the same thing about why
 * people actually open a desk-booking app: to find out whether their team is
 * in. This is the cheapest screen that gives somebody a reason to open it on a
 * day they were not going to book anything.
 *
 * Fixed-desk holders are listed too. A partner never books — they simply have a
 * desk — and a roster that omitted them would be missing most of the people
 * somebody is looking for.
 */
export function WhoClient() {
  const session = useSession();
  const [date, setDate] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [team, setTeam] = React.useState("");

  const dates = useQuery({
    queryKey: ["floor", "dates"],
    queryFn: () => getJson<DatesPayload>("/api/floor/dates"),
  });

  // Default to the demo clock's today, never the browser's.
  const active =
    date ?? dates.data?.days.find((d) => d.isToday)?.date ?? dates.data?.days[0]?.date ?? null;

  const { data, isPending, error } = useQuery({
    queryKey: ["who", active],
    queryFn: () => getJson<Payload>(`/api/people/attending?date=${active}`),
    enabled: Boolean(active),
  });

  if (session.data && !session.data.user) {
    return (
      <StatusMessage tone="caution">
        Sign in to see who is in. Colleagues&rsquo; names are never shown to
        somebody who is not signed in.
      </StatusMessage>
    );
  }

  const teams = [...new Set((data?.people ?? []).map((p) => p.team).filter(Boolean))].sort();
  const people = (data?.people ?? []).filter((p) => {
    if (team && p.team !== team) return false;
    if (!q) return true;
    const needle = q.toLowerCase();
    return (
      p.displayName.toLowerCase().includes(needle) ||
      (p.seatCode ?? "").toLowerCase().includes(needle) ||
      (p.team ?? "").toLowerCase().includes(needle)
    );
  });

  const byTeam = new Map<string, Person[]>();
  for (const p of people) {
    const key = p.team ?? "No team";
    if (!byTeam.has(key)) byTeam.set(key, []);
    byTeam.get(key)!.push(p);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-md border border-hairline bg-surface p-3">
        <label className="text-xs">
          <span className="mb-1 block font-medium text-ink-subtle">Day</span>
          <Select
            className="w-52"
            value={active ?? ""}
            onChange={(e) => setDate(e.target.value)}
            disabled={dates.isPending}
          >
            {(dates.data?.days ?? []).map((d) => (
              <option key={d.date} value={d.date}>
                {d.weekdayLabel} {d.dayLabel} {d.monthLabel}
                {d.isToday ? " — today" : ""}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium text-ink-subtle">Find</span>
          <Input
            className="w-48"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, desk or team"
            aria-label="Find a colleague"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium text-ink-subtle">Team</span>
          <Select className="w-48" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t} value={t!}>
                {t}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {error ? (
        <StatusMessage tone="danger">
          The roster could not be loaded. {(error as Error).message}
        </StatusMessage>
      ) : null}

      {isPending || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-24" label="Loading who is in" />
          <TableSkeleton label="Loading colleagues" rows={6} />
        </div>
      ) : data.total === 0 ? (
        <EmptyState title="Nobody is booked in yet for that day">
          Bookings usually appear the evening before.{" "}
          <Link href="/floor" className="underline underline-offset-4">
            Book a desk
          </Link>{" "}
          and you will be the first.
        </EmptyState>
      ) : (
        <>
          <StatRow columns={3}>
            <Stat
              label="In the office"
              value={data.total}
              accent
              hint="Everybody with a desk that day, including colleagues with an allocated one."
            />
            <Stat
              label="Checked in so far"
              value={data.checkedIn}
              hint="Scanned a desk QR, badged in at the door, or checked in from the app."
            />
            <Stat
              label="Not sharing their desk"
              value={data.hidden}
              hint="Counted, but not named — they have turned off desk sharing in their own settings."
            />
          </StatRow>

          {data.hidden > 0 ? (
            <p className="text-xs text-ink-subtle">
              {data.hidden} {data.hidden === 1 ? "colleague is" : "colleagues are"} in
              but not listed by name. They still count towards the numbers above —
              nobody&rsquo;s privacy choice changes the occupancy figures.
            </p>
          ) : null}

          {[...byTeam.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([teamName, members]) => (
              <Card key={teamName}>
                <CardHeader>
                  <CardTitle>
                    {teamName}
                    <span className="ms-2 text-xs font-normal text-ink-subtle tabular">
                      {members.length} in
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardBody>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Who</Th>
                        <Th>Desk</Th>
                        <Th>Zone</Th>
                        <Th>When</Th>
                        <Th>Arrived</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((p) => (
                        <tr key={p.id}>
                          <Td className="font-medium">
                            {p.displayName}
                            {p.fixedDesk ? (
                              <Badge variant="neutral" className="ms-2">
                                allocated desk
                              </Badge>
                            ) : null}
                          </Td>
                          <Td className="seat-code">
                            {p.seatCode ? (
                              <Link
                                href={`/floor?date=${data.date}&seat=${p.seatCode}`}
                                className="underline underline-offset-4"
                              >
                                {p.seatCode}
                              </Link>
                            ) : (
                              <span className="text-ink-subtle">not shared</span>
                            )}
                          </Td>
                          <Td>{p.zone ?? <span className="text-ink-subtle">—</span>}</Td>
                          <Td>
                            {p.fixedDesk
                              ? "All day"
                              : p.slots.length > 1
                                ? "All day"
                                : (p.slots[0] ?? "—")}
                          </Td>
                          <Td>
                            {p.checkedIn ? (
                              <Badge variant="positive">checked in</Badge>
                            ) : (
                              <span className="text-ink-subtle">not yet</span>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </CardBody>
              </Card>
            ))}
        </>
      )}

      <p className="text-xs text-ink-subtle">
        Your own name is shown to colleagues unless you turn it off in{" "}
        <Link href="/me" className="underline underline-offset-4">
          your settings
        </Link>
        . Turning it off hides your name and your desk, never the fact that a
        desk is taken.
      </p>
    </div>
  );
}
