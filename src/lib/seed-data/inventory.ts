import type { Grade } from "@/lib/db/schema";

/**
 * Floor 4 seat inventory, taken from the bay schedule on the Neetaara furniture
 * layout drawing (09-R8, rev 12-06-2025) now parked in tools/cad/.
 *
 * 141 working seats. Zone B is boardroom and conference — no working seats.
 */
export interface BayDef {
  bay: string;
  zone: "A" | "B" | "C" | "D";
  count: number;
  /** Seat code prefix. Passage bays use PA/PD rather than the bay name. */
  prefix: string;
}

export const BAYS: BayDef[] = [
  { bay: "A1", zone: "A", count: 4, prefix: "A1" },
  { bay: "A2", zone: "A", count: 4, prefix: "A2" },

  { bay: "C1", zone: "C", count: 6, prefix: "C1" },
  { bay: "C2", zone: "C", count: 4, prefix: "C2" },
  { bay: "C3", zone: "C", count: 9, prefix: "C3" },
  { bay: "C4", zone: "C", count: 9, prefix: "C4" },
  { bay: "C5", zone: "C", count: 9, prefix: "C5" },
  { bay: "C6", zone: "C", count: 9, prefix: "C6" },
  { bay: "C7", zone: "C", count: 4, prefix: "C7" },
  { bay: "PA", zone: "C", count: 16, prefix: "PA" },

  { bay: "D1", zone: "D", count: 9, prefix: "D1" },
  { bay: "D2", zone: "D", count: 9, prefix: "D2" },
  { bay: "D3", zone: "D", count: 9, prefix: "D3" },
  { bay: "D4", zone: "D", count: 9, prefix: "D4" },
  { bay: "D5", zone: "D", count: 1, prefix: "D5" },
  { bay: "D6", zone: "D", count: 4, prefix: "D6" },
  { bay: "D7", zone: "D", count: 4, prefix: "D7" },
  { bay: "D8", zone: "D", count: 4, prefix: "D8" },
  { bay: "PD", zone: "D", count: 18, prefix: "PD" },
];

export const TOTAL_SEATS = BAYS.reduce((n, b) => n + b.count, 0); // 141

export const ZONES = [
  { code: "A", displayName: "Zone A — Reception & Cabins", sortOrder: 1 },
  { code: "B", displayName: "Zone B — Boardroom & Conference", sortOrder: 2 },
  { code: "C", displayName: "Zone C — Audit Floor", sortOrder: 3 },
  { code: "D", displayName: "Zone D — Tax & Advisory Floor", sortOrder: 4 },
] as const;

/** Codes for one bay, zero-padded: A1-01 … PD-18. */
export function seatCodes(bay: BayDef): string[] {
  return Array.from(
    { length: bay.count },
    (_, i) => `${bay.prefix}-${String(i + 1).padStart(2, "0")}`,
  );
}

/**
 * FIXED SEAT ALLOCATION — ASSUMPTION. See docs/ASSUMPTIONS.md #2.
 *
 * The drawing gives bay sizes but does not say which physical desks are
 * allocated to whom. This is a deterministic, plausible allocation: cabins and
 * the perimeter bays go to fixed-seat grades, the open bays and both passage
 * runs stay bookable. 47 fixed against 94 bookable, matching headcount exactly.
 */
export const FIXED_SEAT_ALLOCATION: Array<{ codes: string[]; grade: Grade }> = [
  { codes: ["D5-01"], grade: "director" },
  {
    codes: [
      ...seatCodes(BAYS[0]!), // A1-01..04
      ...seatCodes(BAYS[1]!), // A2-01..04
      ...seatCodes(BAYS[2]!), // C1-01..06
      "C2-01",
      "C2-02",
    ],
    grade: "partner", // 16
  },
  {
    codes: [
      "C2-03",
      "C2-04",
      "C4-01",
      "C4-02",
      "C4-03",
      "C4-04",
      "C4-05",
      "C4-06",
      "C4-07",
      "C4-08",
      ...seatCodes(BAYS[15]!), // D6-01..04
      ...seatCodes(BAYS[16]!), // D7-01..04
      ...seatCodes(BAYS[17]!), // D8-01..04
    ],
    grade: "manager", // 22
  },
  {
    codes: ["C3-01", "C3-02", "C3-03", "C3-04", "C3-05", "C3-06", "C3-07", "C3-08"],
    grade: "admin_staff", // 8
  },
];

/**
 * seat_type, derived from the bay. Passage seats are the flip-down desks along
 * the circulation route; C7 is the foldable training bank; A1/A2 and D5 are
 * cabins (D5 being the single management cabin on the drawing).
 */
export function seatTypeForBay(bay: string): "workstation" | "passage" | "foldable" | "cabin" {
  if (bay === "PA" || bay === "PD") return "passage";
  if (bay === "A1" || bay === "A2" || bay === "D5") return "cabin";
  if (bay === "C7") return "foldable";
  return "workstation";
}

/**
 * MEETING ROOMS — ASSUMPTION. See docs/ASSUMPTIONS.md #3.
 * Read off the pax annotations in Zones A and B of the drawing. Names are ours;
 * CBVA may call them something else entirely.
 */
export const MEETING_ROOMS = [
  { name: "Boardroom", capacity: 25, amenities: { screen: true, vc: true, whiteboard: true } },
  { name: "Conference A", capacity: 10, amenities: { screen: true, vc: true } },
  { name: "Conference B", capacity: 8, amenities: { screen: true, vc: false } },
  { name: "Meeting Room 1", capacity: 7, amenities: { screen: true, vc: false } },
  { name: "Meeting Room 2", capacity: 6, amenities: { screen: false, vc: false } },
  { name: "Huddle Room", capacity: 4, amenities: { screen: false, vc: true } },
] as const;

/**
 * HEADCOUNT — from the drawing: Partner 16, CA 54, Article 62, Admin/HR/IT 8,
 * management cabin 1. Total 141.
 *
 * ASSUMPTION (docs/ASSUMPTIONS.md #1): the drawing does not say how the 54 CAs
 * split between Manager and Assistant Manager. Seeded 22/32. WE NEED AN HR LIST.
 */
export const HEADCOUNT: Array<{
  grade: Grade;
  count: number;
  seatMode: "fixed" | "bookable";
}> = [
  { grade: "partner", count: 16, seatMode: "fixed" },
  { grade: "director", count: 1, seatMode: "fixed" },
  { grade: "manager", count: 22, seatMode: "fixed" },
  { grade: "assistant_manager", count: 32, seatMode: "bookable" },
  { grade: "article", count: 62, seatMode: "bookable" },
  { grade: "admin_staff", count: 8, seatMode: "fixed" },
];

export const TOTAL_HEADCOUNT = HEADCOUNT.reduce((n, h) => n + h.count, 0); // 141

export const TEAMS = [
  "Audit & Assurance",
  "Direct Tax",
  "Indirect Tax",
  "Transaction Advisory",
  "Risk Advisory",
  "Corporate Finance",
] as const;

export const ADMIN_TEAMS = ["Administration", "Human Resources", "Information Technology"] as const;

export const GRADE_LABEL: Record<Grade, string> = {
  partner: "Partner",
  director: "Director",
  manager: "Manager",
  assistant_manager: "Assistant Manager",
  article: "Article",
  admin_staff: "Admin / HR / IT",
};
