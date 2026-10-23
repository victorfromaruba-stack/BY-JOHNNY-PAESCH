-- 25 Oct 2026. Ian v2, slice 1: the trip plan. Safe to run twice.
--
-- A member's trip plan (place, dates, who, where they fly from, the week chosen, getting from the
-- airport, things to do, open questions) lives on their own concierge_memory row, beside Ian's notes:
-- the same own-row policy, no new table and no new grant. Private to the member who made it (Victor's
-- decision, 22 Oct 2026); a crew started from it carries the place and dates, as before.
-- Ian may fill a blank and never overwrite a value; that rule is enforced in the function (plan.ts).
-- The plan holds ids, dates, counts and short text, never a price; 4 KB is many times what it needs.
alter table concierge_memory add column if not exists plan jsonb;
alter table concierge_memory drop constraint if exists concierge_memory_plan_check;
alter table concierge_memory add constraint concierge_memory_plan_check
  check (plan is null or (jsonb_typeof(plan) = 'object' and pg_column_size(plan) <= 4096));
