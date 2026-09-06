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

/**
 * ZONE NAMES — two now come from the drawing, two are still ours (A11).
 *
 * A and B were WRONG, and Phase 6's room labels put the contradiction on
 * screen: Zone B was called "Boardroom & Conference" when the boardroom and
 * all four meeting rooms are in Zone A, and Zone B is the flexible room —
 * eight foldable tables on castors, a sofa lounge and the storage credenzas,
 * with zero PAX annotations and zero workstation hatch anywhere in it. A wing
 * labelled "Boardroom" beside a plan label reading "A3 Boardroom · 25 seats"
 * in the OTHER wing is worse than no label at all.
 *
 * C and D are still inventions and are deliberately left alone. The drawing
 * labels the wings A–D and never says what anybody in them does, so "Audit
 * Floor" and "Tax & Advisory Floor" are ours — logged as such in ASSUMPTIONS
 * A11 and in OPEN-QUESTIONS for the client to correct. They are kept because
 * they orient a reader and because replacing them with bare "Zone C" would
 * remove information without removing an unlogged claim.
 */
export const ZONES = [
  { code: "A", displayName: "Zone A — Boardroom & Meeting Rooms", sortOrder: 1 },
  { code: "B", displayName: "Zone B — Flexible Room & Services", sortOrder: 2 },
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
 * MEETING ROOMS — five, all in Zone A, from the drawing's own annotations.
 *
 * Phase 1 seeded six provisionally (25, 10, 8, 7, 6, 4). Two capacities were
 * wrong and one room did not exist. Re-read at the vector level, every zone-A
 * room tag pairs to a PAX annotation within 33 plan units:
 *
 *     A3 -> 25 PAX (18.6 units)    A9 -> 10 PAX (32.2)
 *     A8 ->  7 PAX (25.9)          A7 ->  5 PAX (25.3)
 *     A6 ->  5 PAX (25.9)
 *
 * plus A2 -> 8 PAX, which is the A1/A2 workstation run and not a room, and A4
 * (storage) and A5 (lounge), which carry no PAX at all. 25+10+7+5+5+8 = 60,
 * which is the drawing's whole zone-A count.
 *
 * There are no meeting rooms in Zone B. It has zero PAX annotations anywhere
 * and zero workstation hatch; it is the flexible room. See ASSUMPTIONS A16.
 *
 * `bayCode` is the join key to the floor plan, so a room on the plan and a row
 * on /rooms are the same thing rather than two lists that agree by convention.
 * The NAMES are still ours (A3 aside, "Boardroom" is what the drawing's own
 * "EXISTING HERMENMILLER CHAIRS IN BOARD ROOM TO RETAIN - 25 NOS" note calls
 * it). Bay-coded rather than invented, so there is one fewer thing to be wrong
 * about than "Conference A". ASSUMPTIONS A3 — capacities now come from the
 * drawing; names and the Outlook resource mailboxes do not.
 */
export const MEETING_ROOMS = [
  { bayCode: "A3", name: "Boardroom", capacity: 25, amenities: { screen: true, vc: true, whiteboard: true } },
  { bayCode: "A9", name: "Meeting Room A9", capacity: 10, amenities: { screen: true, vc: true } },
  { bayCode: "A8", name: "Meeting Room A8", capacity: 7, amenities: { screen: true, vc: false } },
  { bayCode: "A7", name: "Meeting Room A7", capacity: 5, amenities: { screen: false, vc: false } },
  { bayCode: "A6", name: "Meeting Room A6", capacity: 5, amenities: { screen: false, vc: false } },
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
