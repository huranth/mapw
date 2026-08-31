-- mapw initial schema — 2026-08-29
-- Local-first terminal app + future realtime collaboration ("invite a friend
-- into a pane"). Everything here is keyed off auth.users; the app ships the
-- anon key and every table is RLS-gated, so the database never trusts a client.

-- ─── profiles ────────────────────────────────────────────────────────────────
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, 'there'), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── devices ─────────────────────────────────────────────────────────────────
-- One row per machine the user runs mapw on. last_ip is captured server-side
-- by the device-heartbeat edge function (never trusted from the client) and
-- exists for the future collab feature: showing "your sessions" and letting a
-- user revoke a device they don't recognize.
create table public.devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  label        text not null,
  platform     text not null,
  app_version  text,
  last_seen_at timestamptz not null default now(),
  last_ip      inet,
  created_at   timestamptz not null default now(),
  unique (user_id, label)
);

create index devices_user_id_idx on public.devices (user_id);

-- ─── usage_daily ─────────────────────────────────────────────────────────────
-- Server-side mirror of the local usage counters (localStorage stays the
-- source of truth; this is the sync target for Insights across devices and
-- the future "shared stats" view).
create table public.usage_daily (
  user_id        uuid not null references auth.users (id) on delete cascade,
  day            date not null,
  sessions       int  not null default 0,
  active_seconds int  not null default 0,
  commands       int  not null default 0,
  terminals      int  not null default 0,
  layouts        int  not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (user_id, day)
);

-- ─── collaboration (future, tables ready now) ───────────────────────────────
create table public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create index workspaces_owner_id_idx on public.workspaces (owner_id);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  invited_by   uuid references auth.users (id),
  joined_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);

create table public.invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  code         text not null unique,
  created_by   uuid not null references auth.users (id) on delete cascade,
  expires_at   timestamptz not null,
  used_by      uuid references auth.users (id),
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index invites_workspace_id_idx on public.invites (workspace_id);

-- ─── row level security ─────────────────────────────────────────────────────
alter table public.profiles          enable row level security;
alter table public.devices           enable row level security;
alter table public.usage_daily       enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.invites           enable row level security;

-- profiles: read your own, plus profiles of people you share a workspace with
-- (collab needs to render co-members); update your own only.
create policy "profiles: read own or co-members"
  on public.profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.workspace_members mine
      join public.workspace_members theirs on mine.workspace_id = theirs.workspace_id
      where mine.user_id = auth.uid() and theirs.user_id = id
    )
  );

create policy "profiles: update own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles: insert own"
  on public.profiles for insert
  with check (id = auth.uid());

-- devices: private to the user.
create policy "devices: all own"
  on public.devices
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- usage_daily: private to the user.
create policy "usage_daily: all own"
  on public.usage_daily
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- workspaces: visible to owner + members; owner manages.
create policy "workspaces: select owner-or-member"
  on public.workspaces for select
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.workspace_members m
      where m.workspace_id = id and m.user_id = auth.uid()
    )
  );

create policy "workspaces: insert own"
  on public.workspaces for insert
  with check (owner_id = auth.uid());

create policy "workspaces: update owner"
  on public.workspaces for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "workspaces: delete owner"
  on public.workspaces for delete
  using (owner_id = auth.uid());

-- workspace_members: members see the roster; the workspace owner manages it;
-- a member can remove themself.
create policy "workspace_members: select members"
  on public.workspace_members for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.workspace_members self
      where self.workspace_id = workspace_id and self.user_id = auth.uid()
    )
    or exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.owner_id = auth.uid()
    )
  );

create policy "workspace_members: insert owner"
  on public.workspace_members for insert
  with check (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.owner_id = auth.uid()
    )
  );

create policy "workspace_members: delete owner-or-self"
  on public.workspace_members for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.owner_id = auth.uid()
    )
  );

-- invites: workspace members can list/redeem-view; owner creates and marks used.
create policy "invites: select members"
  on public.invites for select
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.workspace_members m
      where m.workspace_id = workspace_id and m.user_id = auth.uid()
    )
    or exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.owner_id = auth.uid()
    )
  );

create policy "invites: insert owner"
  on public.invites for insert
  with check (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.owner_id = auth.uid()
    )
  );

create policy "invites: update owner"
  on public.invites for update
  using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.owner_id = auth.uid()
    )
  );
