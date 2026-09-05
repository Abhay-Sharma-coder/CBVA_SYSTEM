"use client";

/**
 * The one HTTP helper for admin screens.
 *
 * There were four copies of this by the end of Phase 4 — in session.ts, in the
 * floor-plan editor, in the notification inbox and a richer one in
 * use-bookings.ts — and they had already drifted: two of them threw a bare
 * `Error` and lost the `code` and `details` the API sends, which is exactly the
 * information a dialog needs to say "Priya has already booked that desk"
 * instead of "Request failed (409)".
 */
export class ApiError extends Error {
  code?: string;
  status?: number;
  details?: unknown;

  constructor(message: string, init: { code?: string; status?: number; details?: unknown } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = init.code;
    this.status = init.status;
    this.details = init.details;
  }
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      details?: unknown;
    };
    throw new ApiError(body.error ?? `Request failed (${res.status})`, {
      code: body.code,
      status: res.status,
      details: body.details,
    });
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const getJson = <T,>(url: string) => request<T>(url);
