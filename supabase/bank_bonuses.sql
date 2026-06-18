-- Bank Bonuses feature — run this in your Supabase project:
-- SQL Editor → New query → paste & run.
-- Safe to re-run (idempotent).

create table if not exists bank_bonuses (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  bank                 text not null,
  account_type         text,
  bonus_amount         numeric(15,2) not null default 0,
  url                  text,
  open_date            date,
  deadline             date,                 -- offer "open by" / requirements-met-by date
  expected_payout_date date,                 -- when the bonus should post
  received             boolean not null default false,
  received_date        date,
  notes                text,
  -- checklist of requirements: [{ id, label, target, due_date, done }]
  tasks                jsonb not null default '[]'::jsonb,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

-- Row Level Security: each user only sees their own bonuses
alter table bank_bonuses enable row level security;

drop policy if exists "bank_bonuses: own rows" on bank_bonuses;
create policy "bank_bonuses: own rows"
  on bank_bonuses for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_bank_bonuses_user_id on bank_bonuses (user_id);

-- Auto-update updated_at (function also defined in schema.sql; create or replace is safe)
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create or replace trigger bank_bonuses_updated_at
  before update on bank_bonuses
  for each row execute function update_updated_at();
