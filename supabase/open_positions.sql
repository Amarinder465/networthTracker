-- Open positions snapshot, one row per tax lot. Powers the "What if you sold
-- today" panel on the Trading → Stats view. Run once in the Supabase SQL
-- editor (SQL Editor → New query → paste & run).
--
-- Rows are a point-in-time copy of the Robinhood tax-lot screen plus a price,
-- refreshed on request; the app only reads them. Taxable accounts only — IRA
-- gains and losses never hit the tax return.

create table if not exists open_positions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  account       text not null,                 -- display label, e.g. '••••5588', '1M dollar Port'
  symbol        text not null,
  quantity      numeric(18,6) not null,
  cost_basis    numeric(15,2) not null,        -- tax basis for the lot, including any wash-sale adjustment
  opened_on     date,                          -- acquisition date; decides short- vs long-term
  last_price    numeric(15,4),
  priced_at     timestamptz,
  deferred_loss numeric(15,2) not null default 0, -- earlier wash-sale loss already inside cost_basis
  wash_status   text not null default 'clean' check (wash_status in ('clean', 'gray', 'washed')),
  wash_note     text,
  created_at    timestamptz default now()
);

alter table open_positions enable row level security;

drop policy if exists "open_positions: own rows" on open_positions;
create policy "open_positions: own rows" on open_positions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_open_positions_user_id on open_positions (user_id);
