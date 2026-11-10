-- Taxes tab: one row per user per tax year.
-- Run in Supabase: SQL Editor → New query → paste & run. Safe to re-run.
--
-- Only the numbers typed or read off a W-2 or pay stub are stored (employer
-- name, wages, withholding, pay date). The PDF itself, the SSN and any account
-- numbers are never uploaded.

create table if not exists tax_profiles (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  tax_year               integer not null,
  filing_status          text not null default 'single'
                         check (filing_status in ('single', 'mfj', 'mfs', 'hoh')),
  dependents_under_17    integer not null default 0 check (dependents_under_17 >= 0),
  other_dependents       integer not null default 0 check (other_dependents >= 0),
  -- W-2s and pay stubs, one object per document:
  --   W-2:  { kind: 'w2', employer, wages, fedWithheld, stateWages, stateWithheld }
  --   stub: { kind: 'stub', employer, payDate, frequency, stillEmployed,
  --           gross, fedTaxable, fedWithheld, stateWithheld, sdi,
  --           curFedTaxable, curFedWithheld, curStateWithheld }   (YTD + this check)
  w2s                    jsonb not null default '[]'::jsonb,
  other_income           numeric(15,2) not null default 0,
  itemized_deductions    numeric(15,2),
  fed_estimated_payments numeric(15,2) not null default 0,
  ca_estimated_payments  numeric(15,2) not null default 0,
  -- { "<trades.id>": "short" | "long" } — holding-period overrides
  term_overrides         jsonb not null default '{}'::jsonb,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now(),
  unique (user_id, tax_year)
);

alter table tax_profiles enable row level security;

-- Signed-out visitors never need this table; RLS already blocks them, but
-- don't leave the default anon grant in place either.
revoke all on tax_profiles from anon;

drop policy if exists "tax_profiles: own rows" on tax_profiles;
create policy "tax_profiles: own rows" on tax_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_tax_profiles_user_id on tax_profiles (user_id, tax_year);

-- Retirement contribution plan for the year (added after the first release):
--   { age50, covered, spouseCovered, alreadyIra, tradIra, rothIra, extra401k }
alter table tax_profiles add column if not exists retirement jsonb not null default '{}'::jsonb;

create or replace trigger tax_profiles_updated_at
  before update on tax_profiles
  for each row execute function update_updated_at();
