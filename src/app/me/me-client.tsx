"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, getJson, request } from "@/components/admin/api";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  StatusMessage,
} from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

interface Me {
  displayName: string;
  email: string;
  grade: string;
  team: string | null;
  seatMode: string;
  shareAttendance: boolean;
}

const GRADE_LABEL: Record<string, string> = {
  partner: "Partner",
  director: "Director",
  manager: "Manager",
  assistant_manager: "Assistant Manager",
  article: "Article",
  admin_staff: "Admin / HR / IT",
};

/**
 * A person's own settings. One switch today, and it is a real one.
 *
 * The coworker roster defaults to ON, because a directory nobody has opted into
 * is an empty screen that argues for nothing — and countering low booking
 * uptake is the entire reason the roster exists. But an internal roster with no
 * way out is the kind of thing HR objects to late, so the way out is here,
 * obvious, and takes one click.
 */
export function MeClient() {
  const qc = useQueryClient();
  const [notice, setNotice] = React.useState<string | null>(null);

  const me = useQuery({ queryKey: ["me"], queryFn: () => getJson<Me>("/api/me") });

  const save = useMutation({
    mutationFn: (shareAttendance: boolean) =>
      request<{ shareAttendance: boolean }>("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ shareAttendance }),
      }),
    onSuccess: (res) => {
      setNotice(
        res.shareAttendance
          ? "Colleagues can see your name and desk again."
          : "Your name and desk are now hidden from colleagues.",
      );
      void qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: ["who"] });
    },
    onError: (err: ApiError) => setNotice(err.message),
  });

  if (me.isPending || !me.data) return <Skeleton className="h-64" label="Loading your settings" />;

  return (
    <div className="space-y-6">
      {notice ? <StatusMessage tone="positive">{notice}</StatusMessage> : null}

      <Card>
        <CardHeader>
          <CardTitle>You</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2">
            {[
              ["Name", me.data.displayName],
              ["Email", me.data.email],
              ["Grade", GRADE_LABEL[me.data.grade] ?? me.data.grade],
              ["Team", me.data.team ?? "—"],
              [
                "Desk",
                me.data.seatMode === "fixed"
                  ? "You have an allocated desk"
                  : "You book a desk for each day in the office",
              ],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] font-medium tracking-wide text-ink-subtle uppercase">
                  {k}
                </dt>
                <dd className="mt-0.5 text-sm text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Visibility</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <Switch
            label="Let colleagues see my name and desk"
            description="Your name appears on the floor plan and in Who's In, so people can find you. Turning this off hides your NAME — never the fact that a desk is taken, so nothing you do here changes the occupancy figures the firm reports."
            checked={me.data.shareAttendance}
            onCheckedChange={(next) => save.mutate(next)}
            disabled={save.isPending}
          />
          {!me.data.shareAttendance ? (
            <StatusMessage tone="neutral">
              You are currently hidden. Colleagues will see your desk as taken by
              &ldquo;a colleague&rdquo;, and you will still be counted in the
              office numbers.
            </StatusMessage>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
