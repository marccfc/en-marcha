-- En Marcha V3: correcciones atómicas de vídeos e ideas.
-- Ejecuta este archivo UNA VEZ en Supabase > SQL Editor, después de V1 y V2.
-- No borra contenido existente.

begin;

create or replace function public.update_video_details(
  target_video_id uuid,
  target_title text,
  target_channel_id text,
  target_scheduled_for date,
  target_notes text,
  target_resource_url text,
  reset_workflow boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_video public.video_entries;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into target_video
  from public.video_entries
  where id = target_video_id
  for update;

  if target_video.id is null or not public.has_workspace_access(target_video.workspace_id) then
    raise exception 'Video not found or access denied';
  end if;

  if coalesce(char_length(trim(target_title)), 0) = 0 or char_length(trim(target_title)) > 150 then
    raise exception 'A valid title is required';
  end if;

  if not exists (
    select 1 from public.channels
    where workspace_id = target_video.workspace_id and id = target_channel_id
  ) then
    raise exception 'Channel not found in workspace';
  end if;

  -- Keep the original idea and its scheduled video aligned when its channel is corrected.
  if target_video.idea_id is not null and target_video.channel_id <> target_channel_id then
    update public.content_ideas
    set channel_id = target_channel_id
    where id = target_video.idea_id and workspace_id = target_video.workspace_id;
  end if;

  update public.video_entries
  set title = trim(target_title),
      channel_id = target_channel_id,
      scheduled_for = target_scheduled_for,
      notes = coalesce(target_notes, ''),
      resource_url = nullif(trim(target_resource_url), ''),
      current_stage = case when reset_workflow then 'idea' else target_video.current_stage end,
      status = case when reset_workflow then 'pending' else target_video.status end,
      completed_at = case when reset_workflow then null else target_video.completed_at end,
      updated_by = auth.uid()
  where id = target_video.id;
end;
$$;

create or replace function public.delete_video_and_restore_idea(target_video_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_video public.video_entries;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into target_video
  from public.video_entries
  where id = target_video_id
  for update;

  if target_video.id is null or not public.has_workspace_access(target_video.workspace_id) then
    raise exception 'Video not found or access denied';
  end if;

  delete from public.video_entries where id = target_video.id;

  if target_video.idea_id is not null then
    update public.content_ideas
    set status = 'idea'
    where id = target_video.idea_id and workspace_id = target_video.workspace_id;
  end if;
end;
$$;

grant execute on function public.update_video_details(uuid, text, text, date, text, text, boolean) to authenticated;
grant execute on function public.delete_video_and_restore_idea(uuid) to authenticated;

commit;
