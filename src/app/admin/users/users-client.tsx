"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, getJson, request } from "@/components/admin/api";
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
import { TableSkeleton } from "@/components/ui/skeleton";
import { Stat, StatRow } from "@/components/ui/stat";
import { Switch } from "@/components/ui/switch";

interface UserRow {
  id: string;
  displayName: string;
  email: string;
  grade: string;
  team: string | null;
  seatMode: string;
  isAdmin: boolean;
  isActive: boolean;
  shareAttendance: boolean;
  fixedSeatCode: string | null;
  upcomingBookings: number;
}

const GRADES = [
  ["partner", "Partner"],
  ["director", "Director"],
  ["manager", "Manager"],
  ["assistant_manager", "Assistant Manager"],
  ["article", "Article"],
  ["admin_staff", "Admin / HR / IT"],
] as const;

/**
 * The staff roster.
 *
 * THIS SCREEN IS HOW A1 GETS ANSWERED. The Manager / Assistant Manager split is
 * the single number that sets the denominator for every occupancy figure in the
 * product, and it is currently a guess (22/32). When the HR list arrives,
 * somebody types it in here — it must never be a code change, because it will
 * change again.
 */
export function UsersClient() {
  const qc = useQueryClient();
  const [q, setQ] = React.useState("");
  const [grade, setGrade] = React.useState("");
  const [active, setActive] = React.useState("all");
  const [notice, setNotice] = React.useState<{
    tone: "positive" | "danger";
    text: string;
  } | null>(null);

  const params = new URLSearchParams({ active });
  if (q) params.set("q", q);
  if (grade) params.set("grade", grade);

  const users = useQuery({
    queryKey: ["admin", "users", params.toString()],
    queryFn: () => getJson<{ users: UserRow[]; teams: string[] }>(`/api/admin/users?${params}`),
  });

  const patch = useMutation({
    mutationFn: (vars: { id: string; body: Record<string, unknown>; name: string }) =>
      request(`/api/admin/users/${vars.id}`, {
        method: "PATCH",
        body: JSON.stringify(vars.body),
      }),
    onSuccess: (_d, vars) => {
      setNotice({ tone: "positive", text: `${vars.name} updated.` });
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err: ApiError) => setNotice({ tone: "danger", text: err.message }),
  });

  const rows = users.data?.users ?? [];
  const byMode = rows.reduce(
    (a, u) => ({
      fixed: a.fixed + (u.seatMode === "fixed" ? 1 : 0),
      bookable: a.bookable + (u.seatMode === "bookable" ? 1 : 0),
      inactive: a.inactive + (u.isActive ? 0 : 1),
      hidden: a.hidden + (u.shareAttendance ? 0 : 1),
    }),
    { fixed: 0, bookable: 0, inactive: 0, hidden: 0 },
  );

  return (
    <div className="space-y-6">
      {notice ? <StatusMessage tone={notice.tone}>{notice.text}</StatusMessage> : null}

      <StatRow>
        <Stat
          label="Must book"
          value={byMode.bookable}
          hint="Assistant Manager and below. This is the demand side of every occupancy figure."
        />
        <Stat
          label="Allocated desk"
          value={byMode.fixed}
          hint="Manager and above, plus admin staff. They only enter the data by releasing a desk."
        />
        <Stat label="Deactivated" value={byMode.inactive} hint="No longer booking. Their future bookings were cancelled." />
        <Stat
          label="Opted out of the roster"
          value={byMode.hidden}
          hint="Their name is hidden from colleagues. Their desk still counts."
        />
      </StatRow>

      <StatusMessage tone="neutral">
        The Manager / Assistant Manager split shown here is{" "}
        <strong className="font-medium">our assumption, not CBVA&rsquo;s answer</strong>{" "}
        (open question A1). It sets the denominator for every number in the
        analytics. When the HR list arrives it is typed in here — no code change.
      </StatusMessage>

      <Card>
        <CardHeader className="flex flex-wrap items-end gap-3">
          <CardTitle className="me-auto">People</CardTitle>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-ink-subtle">Search</span>
            <Input
              className="w-44"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name or email"
              aria-label="Search people"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-ink-subtle">Grade</span>
            <Select className="w-44" value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="">All grades</option>
              {GRADES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-ink-subtle">Status</span>
            <Select className="w-32" value={active} onChange={(e) => setActive(e.target.value)}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Deactivated</option>
            </Select>
          </label>
        </CardHeader>
        <CardBody>
          {users.isPending ? (
            <TableSkeleton label="Loading people" rows={8} />
          ) : rows.length === 0 ? (
            <EmptyState title="Nobody matches those filters">
              Clear the search or widen the grade filter.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Grade</Th>
                  <Th>Seat</Th>
                  <Th>Desk</Th>
                  <Th>Team</Th>
                  <Th numeric>Ahead</Th>
                  <Th>Admin</Th>
                  <Th>Active</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <Td>
                      <span className="block font-medium">{u.displayName}</span>
                      <span className="block text-xs text-ink-subtle">{u.email}</span>
                    </Td>
                    <Td>
                      <Select
                        className="w-44"
                        aria-label={`Grade of ${u.displayName}`}
                        value={u.grade}
                        onChange={(e) =>
                          patch.mutate({
                            id: u.id,
                            name: u.displayName,
                            body: { grade: e.target.value },
                          })
                        }
                      >
                        {GRADES.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td>
                      <Select
                        className="w-32"
                        aria-label={`Seat mode of ${u.displayName}`}
                        value={u.seatMode}
                        onChange={(e) =>
                          patch.mutate({
                            id: u.id,
                            name: u.displayName,
                            body: { seatMode: e.target.value },
                          })
                        }
                      >
                        <option value="bookable">Must book</option>
                        <option value="fixed">Allocated</option>
                      </Select>
                    </Td>
                    <Td className="seat-code">
                      {u.fixedSeatCode ?? <span className="text-ink-subtle">—</span>}
                    </Td>
                    <Td>{u.team ?? <span className="text-ink-subtle">—</span>}</Td>
                    <Td numeric>{u.upcomingBookings}</Td>
                    <Td>
                      <Switch
                        label={`Administrator: ${u.displayName}`}
                        hideLabel
                        checked={u.isAdmin}
                        onCheckedChange={(next) =>
                          patch.mutate({
                            id: u.id,
                            name: u.displayName,
                            body: { isAdmin: next },
                          })
                        }
                      />
                    </Td>
                    <Td>
                      <Switch
                        label={`Active: ${u.displayName}`}
                        hideLabel
                        checked={u.isActive}
                        onCheckedChange={(next) =>
                          patch.mutate({
                            id: u.id,
                            name: u.displayName,
                            body: { isActive: next },
                          })
                        }
                      />
                      {!u.isActive ? (
                        <Badge variant="caution" className="ms-2">
                          off
                        </Badge>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
