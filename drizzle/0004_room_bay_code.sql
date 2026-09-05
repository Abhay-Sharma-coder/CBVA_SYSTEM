-- Phase 6 — the meeting rooms carry the architect's bay tag.
--
-- Hand-written and hand-registered in drizzle/meta/_journal.json, like 0001,
-- 0002 and 0003. drizzle-kit's snapshot chain has been broken since 0001 was
-- authored by hand, and re-generating over the top of these files would drop
-- every partial index and CHECK in them.
--
-- Phase 1 seeded six meeting rooms from a reading of the drawing: 25, 10, 8, 7,
-- 6, 4. Re-read at the vector level, the drawing shows FIVE, all in Zone A, and
-- names each one with a bay tag that pairs to a PAX annotation within 33 plan
-- units: A3=25, A9=10, A8=7, A7=5, A6=5. Two capacities were wrong and one room
-- did not exist.
--
-- bay_code is what lets the floor plan and /rooms be joined. Without it the
-- only shared key is the display NAME, which is the one field CBVA is expected
-- to change (ASSUMPTIONS A3) — a join that breaks the moment the client answers
-- a question is not a join.
--
-- Nullable on purpose. A room CBVA adds later that is not on this drawing has
-- no bay tag, and inventing one would be worse than leaving it null.
ALTER TABLE meeting_rooms ADD COLUMN IF NOT EXISTS bay_code text;

COMMENT ON COLUMN meeting_rooms.bay_code IS
  'The architect''s bay tag (A3, A9, A8, A7, A6). Joins /rooms to the floor plan.';
