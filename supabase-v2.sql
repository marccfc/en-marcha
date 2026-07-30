-- En Marcha V2: ideas, ficha de vídeo, flujo y actividad.
-- Ejecuta este archivo UNA VEZ en Supabase > SQL Editor, después de la instalación inicial (V1).
-- Es una migración aditiva: no borra vídeos, canales ni miembros existentes.

begin;

alter table public.video_entries
  add column if not exists format text,
  add column if not exists notes text not null default '',
  add column if not exists resource_url text,
  add column if not exists current_stage text not null default 'idea';

alter table public.video_entries
  drop constraint if exists video_entries_resource_url_check;
alter table public.video_entries
  add constraint video_entries_resource_url_check
  check (resource_url is null or resource_url ~* '^https://[^[:space:]]+$');

alter table public.video_entries
  drop constraint if exists video_entries_current_stage_check;
alter table public.video_entries
  add constraint video_entries_current_stage_check
  check (current_stage in ('idea', 'script', 'production_pack', 'visual', 'editing', 'published'));

-- Conserva las publicaciones antiguas y les asigna una fase inicial coherente.
update public.video_entries
set current_stage = case
  when status = 'completed' then 'published'
  when status = 'waiting' then 'visual'
  when status = 'progress' then 'script'
  else 'idea'
end
where current_stage = 'idea';

create table if not exists public.content_ideas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_id text not null,
  title text not null check (char_length(title) between 1 and 150),
  format text,
  notes text not null default '',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'idea' check (status in ('idea', 'selected', 'scheduled', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, channel_id) references public.channels(workspace_id, id) on delete restrict
);

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  video_entry_id uuid references public.video_entries(id) on delete set null,
  idea_id uuid references public.content_ideas(id) on delete cascade,
  event_type text not null check (event_type in ('idea_created', 'idea_scheduled', 'video_created', 'stage_changed', 'details_updated', 'video_deleted')),
  message text not null check (char_length(message) between 1 and 280),
  created_at timestamptz not null default now()
);

-- Preserve deletion events after their video is removed. The event message keeps its title.
alter table public.activity_events drop constraint if exists activity_events_video_entry_id_fkey;
alter table public.activity_events
  add constraint activity_events_video_entry_id_fkey
  foreign key (video_entry_id) references public.video_entries(id) on delete set null;

create index if not exists content_ideas_workspace_status_idx on public.content_ideas (workspace_id, status, created_at desc);
create index if not exists content_ideas_workspace_channel_idx on public.content_ideas (workspace_id, channel_id);
create index if not exists video_entries_workspace_stage_date_idx on public.video_entries (workspace_id, current_stage, scheduled_for);
create index if not exists activity_events_workspace_created_idx on public.activity_events (workspace_id, created_at desc);

-- Link an idea to its final scheduled video, if it has been promoted.
alter table public.video_entries add column if not exists idea_id uuid references public.content_ideas(id) on delete set null;
create unique index if not exists video_entries_idea_id_unique on public.video_entries (idea_id) where idea_id is not null;

drop trigger if exists content_ideas_updated_at on public.content_ideas;
create trigger content_ideas_updated_at before update on public.content_ideas
for each row execute function public.set_updated_at();

alter table public.content_ideas enable row level security;
alter table public.activity_events enable row level security;

-- Allow this migration to be safely re-run if a previous execution was interrupted.
drop policy if exists "Members can view ideas" on public.content_ideas;
drop policy if exists "Members can add ideas" on public.content_ideas;
drop policy if exists "Members can change ideas" on public.content_ideas;
drop policy if exists "Members can delete ideas" on public.content_ideas;
drop policy if exists "Members can view activity" on public.activity_events;
drop policy if exists "Members can add activity" on public.activity_events;

create policy "Members can view ideas" on public.content_ideas
for select to authenticated using (public.has_workspace_access(workspace_id));
create policy "Members can add ideas" on public.content_ideas
for insert to authenticated with check (public.has_workspace_access(workspace_id) and created_by = auth.uid());
create policy "Members can change ideas" on public.content_ideas
for update to authenticated using (public.has_workspace_access(workspace_id)) with check (public.has_workspace_access(workspace_id));
create policy "Members can delete ideas" on public.content_ideas
for delete to authenticated using (public.has_workspace_access(workspace_id));

create policy "Members can view activity" on public.activity_events
for select to authenticated using (public.has_workspace_access(workspace_id));
create policy "Members can add activity" on public.activity_events
for insert to authenticated with check (public.has_workspace_access(workspace_id) and actor_id = auth.uid());

-- The initial V1 policies already protect video_entries. V2 needs only table privileges.
grant select, insert, update, delete on public.content_ideas, public.activity_events to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'content_ideas'
  ) then
    alter publication supabase_realtime add table public.content_ideas;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity_events'
  ) then
    alter publication supabase_realtime add table public.activity_events;
  end if;
end;
$$;

commit;
