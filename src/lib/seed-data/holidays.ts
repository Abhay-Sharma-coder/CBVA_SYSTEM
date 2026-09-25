/**
 * Indian public holidays, 2026 and 2027.
 *
 * ASSUMPTION (docs/ASSUMPTIONS.md #6). This is the national/Maharashtra set an
 * office in Mumbai would typically observe. Every firm publishes its own list
 * and CBVA's will differ — the lunar-calendar dates especially. Replace with
 * CBVA's official holiday circular before go-live; the booking engine treats
 * these as non-working days, so a wrong date means staff cannot book a day they
 * are expected in.
 */
export const HOLIDAYS: Array<{ date: string; name: string }> = [
  // ---- 2026 ----
  { date: "2026-01-26", name: "Republic Day" },
  { date: "2026-03-04", name: "Holi" },
  { date: "2026-03-19", name: "Gudi Padwa" },
  { date: "2026-03-21", name: "Id-ul-Fitr" },
  { date: "2026-03-26", name: "Ram Navami" },
  { date: "2026-03-31", name: "Mahavir Jayanti" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-14", name: "Dr. Ambedkar Jayanti" },
  { date: "2026-05-01", name: "Maharashtra Day" },
  { date: "2026-05-27", name: "Bakri Id" },
  { date: "2026-08-15", name: "Independence Day" },
  { date: "2026-08-26", name: "Raksha Bandhan" },
  { date: "2026-09-04", name: "Janmashtami" },
  { date: "2026-09-14", name: "Ganesh Chaturthi" },
  { date: "2026-10-02", name: "Gandhi Jayanti" },
  { date: "2026-10-20", name: "Dussehra" },
  { date: "2026-11-08", name: "Diwali — Lakshmi Puja" },
  { date: "2026-11-09", name: "Diwali — Balipratipada" },
  { date: "2026-11-24", name: "Guru Nanak Jayanti" },
  { date: "2026-12-25", name: "Christmas Day" },

  // ---- 2027 ----
  { date: "2027-01-26", name: "Republic Day" },
  { date: "2027-02-21", name: "Holi" },
  { date: "2027-03-11", name: "Id-ul-Fitr" },
  { date: "2027-03-19", name: "Gudi Padwa" },
  { date: "2027-03-26", name: "Good Friday" },
  { date: "2027-04-15", name: "Ram Navami" },
  { date: "2027-04-19", name: "Mahavir Jayanti" },
  { date: "2027-05-01", name: "Maharashtra Day" },
  { date: "2027-05-17", name: "Bakri Id" },
  { date: "2027-08-15", name: "Independence Day" },
  { date: "2027-08-16", name: "Raksha Bandhan" },
  { date: "2027-08-25", name: "Janmashtami" },
  { date: "2027-09-03", name: "Ganesh Chaturthi" },
  { date: "2027-10-02", name: "Gandhi Jayanti" },
  { date: "2027-10-09", name: "Dussehra" },
  { date: "2027-10-28", name: "Diwali — Lakshmi Puja" },
  { date: "2027-10-29", name: "Diwali — Balipratipada" },
  { date: "2027-11-13", name: "Guru Nanak Jayanti" },
  { date: "2027-12-25", name: "Christmas Day" },
];
