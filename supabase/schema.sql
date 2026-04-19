-- Run this in your Supabase project: SQL Editor → New query → paste & run

create table if not exists assets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  category    text not null default 'Other',
  value       numeric(15,2) not null default 0,
  notes                text,
  include_in_net_worth boolean not null default true,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

create table if not exists bills (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  amount      numeric(15,2) not null default 0,
  category    text not null default 'Other',
  frequency   text not null default 'monthly',
  due_date    date,
  is_paid     boolean not null default false,
  notes       text,
  created_at  timestamptz default now()
);

create table if not exists loans (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  lender        text,
  category      text not null default 'Personal',
  balance       numeric(15,2) not null default 0,
  original_balance numeric(15,2),
  interest_rate numeric(6,3),
  min_payment   numeric(15,2),
  term_months   integer,
  start_date    date,
  due_date             date,
  hoa                  numeric(15,2),
  notes                text,
  include_in_net_worth boolean not null default true,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

create table if not exists loan_payments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  loan_id     uuid not null references loans(id) on delete cascade,
  amount      numeric(15,2) not null,
  principal   numeric(15,2) not null,
  interest    numeric(15,2) not null,
  balance_after numeric(15,2) not null,
  payment_date  date not null default current_date,
  note        text,
  created_at  timestamptz default now()
);

create table if not exists net_worth_history (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null default current_date,
  total_assets  numeric(15,2) not null default 0,
  total_debt    numeric(15,2) not null default 0,
  net_worth     numeric(15,2) not null default 0,
  note          text,
  created_at    timestamptz default now()
);

create table if not exists trips (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  destination text,
  start_date  date,
  end_date    date,
  travelers   integer not null default 1,
  created_at  timestamptz default now()
);

create table if not exists trip_items (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  category   text not null,
  label      text,
  budgeted   numeric(15,2) not null default 0,
  actual     numeric(15,2),
  created_at timestamptz default now()
);

-- Enable Row Level Security
alter table assets            enable row level security;
alter table bills             enable row level security;
alter table loans             enable row level security;
alter table loan_payments     enable row level security;
alter table net_worth_history enable row level security;
alter table trips             enable row level security;
alter table trip_items        enable row level security;

-- RLS Policies
create policy "assets: own rows"        on assets            for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "bills: own rows"         on bills             for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "loans: own rows"         on loans             for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "loan_payments: own rows" on loan_payments     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "history: own rows"       on net_worth_history for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "trips: own rows"        on trips             for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "trip_items: own rows"   on trip_items        for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Indexes
create index if not exists idx_assets_user_id            on assets            (user_id);
create index if not exists idx_bills_user_id             on bills             (user_id);
create index if not exists idx_loans_user_id             on loans             (user_id);
create index if not exists idx_loan_payments_loan_id     on loan_payments     (loan_id);
create index if not exists idx_loan_payments_user_id     on loan_payments     (user_id);
create index if not exists idx_net_worth_history_user_id on net_worth_history (user_id, snapshot_date);
create index if not exists idx_trips_user_id            on trips             (user_id);
create index if not exists idx_trip_items_trip_id       on trip_items        (trip_id);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create or replace trigger assets_updated_at before update on assets for each row execute function update_updated_at();
create or replace trigger loans_updated_at  before update on loans  for each row execute function update_updated_at();

-- Monthly auto-payment function (called by pg_cron)
create or replace function process_monthly_loan_payments()
returns void language plpgsql as $$
declare
  loan record;
  monthly_interest numeric;
  principal_paid   numeric;
  new_balance      numeric;
begin
  for loan in
    select * from loans
    where due_date = current_date
      and balance > 0
      and min_payment is not null
  loop
    monthly_interest := round(loan.balance * (loan.interest_rate / 100.0 / 12.0), 2);
    principal_paid   := least(loan.min_payment - monthly_interest, loan.balance);
    new_balance      := greatest(loan.balance - principal_paid, 0);

    update loans
    set balance   = new_balance,
        due_date  = loan.due_date + interval '1 month'
    where id = loan.id;

    insert into loan_payments (user_id, loan_id, amount, principal, interest, balance_after, payment_date)
    values (loan.user_id, loan.id, loan.min_payment, principal_paid, monthly_interest, new_balance, current_date);
  end loop;
end;
$$;

-- pg_cron: run daily at 8am UTC, processes any loans due today
-- Enable pg_cron in Supabase: Database → Extensions → pg_cron → enable
-- Then run this separately after enabling pg_cron:
--
-- select cron.schedule(
--   'monthly-loan-payments',
--   '0 8 * * *',
--   $$ select process_monthly_loan_payments(); $$
-- );
