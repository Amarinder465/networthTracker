-- Run this in your Supabase project: SQL Editor → New query → paste & run
--
-- Trip expenses had no date of their own, so the date was being carried in the
-- description text ("Tank Full · Aug 20") and parsed back out for sorting.
-- This gives them a real column; scripts/backfill-expense-dates.mjs migrates
-- the existing descriptions into it.

alter table split_expenses add column if not exists expense_date date;

create index if not exists idx_split_expenses_event_date
  on split_expenses (event_id, expense_date);
