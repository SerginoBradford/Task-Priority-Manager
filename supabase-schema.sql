-- Mes priorités : tables et règles de sécurité
-- À coller dans Supabase > SQL Editor > New query, puis cliquer sur "Run".
-- Chaque utilisateur ne peut lire et modifier QUE ses propres tâches et notes.

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null,
  notes       text not null default '',
  priority    smallint not null default 3 check (priority between 1 and 4),
  due_date    date,
  duration    integer,
  category    text not null default '',
  done        boolean not null default false,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default '',
  content     text not null default '',
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists tasks_user_idx on public.tasks (user_id);
create index if not exists notes_user_idx on public.notes (user_id);

alter table public.tasks enable row level security;
alter table public.notes enable row level security;

drop policy if exists "Mes tâches uniquement" on public.tasks;
create policy "Mes tâches uniquement" on public.tasks
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Mes notes uniquement" on public.notes;
create policy "Mes notes uniquement" on public.notes
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.notes to authenticated;
