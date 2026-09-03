"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface SessionUser {
  email: string;
  displayName: string;
  grade: string;
  seatMode: "fixed" | "bookable";
  isAdmin: boolean;
  team: string | null;
}

export interface SessionPayload {
  appMode: "demo" | "production";
  offsetSeconds: number;
  user: SessionUser | null;
  roles: Array<{
    email: string;
    displayName: string;
    grade: string;
    seatMode: "fixed" | "bookable";
    isAdmin: boolean;
  }>;
}

export interface ClockPayload {
  now: string;
  offsetSeconds: number;
  appMode: "demo" | "production";
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request to ${url} failed with ${res.status}`);
  return res.json() as Promise<T>;
}

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => getJson<SessionPayload>("/api/session"),
  });
}

/**
 * The shared clock. Polled rather than read from the browser's own Date, so the
 * whole product agrees on "now" and a demo clock shift is visible everywhere.
 */
export function useClock() {
  return useQuery({
    queryKey: ["clock"],
    queryFn: () => getJson<ClockPayload>("/api/clock"),
    refetchInterval: 30_000,
  });
}

export function useSwitchRole() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not switch role. Try again.");
      }
      return res.json();
    },
    // Everything on screen is scoped to who you are. Invalidating the query
    // cache only refreshes the client components; the page body is server
    // rendered from the same cookie, so it needs router.refresh() too.
    onSuccess: async () => {
      await qc.invalidateQueries();
      router.refresh();
    },
  });
}

export function useShiftClock() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: async (body: { action: "advance"; seconds: number } | { action: "reset" }) => {
      const res = await fetch("/api/clock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Could not shift the demo clock.");
      return res.json() as Promise<ClockPayload>;
    },
    // Same reasoning as useSwitchRole: server components read the clock too.
    onSuccess: async () => {
      await qc.invalidateQueries();
      router.refresh();
    },
  });
}
