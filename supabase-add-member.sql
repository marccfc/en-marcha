-- Añade manualmente a una persona ya autenticada al espacio compartido.
-- Antes de ejecutarlo, Ainhoa debe abrir la app, escribir su correo y abrir el magic link.
-- Sustituye SOLO los dos textos entre comillas simples por valores reales.

do $$
declare
  target_workspace_id uuid;
  target_user_id uuid;
begin
  select id into target_workspace_id
  from public.workspaces
  where invite_code = upper(trim('PEGA_AQUI_TU_CODIGO_DE_8_CARACTERES'));

  if target_workspace_id is null then
    raise exception 'No existe ningún espacio con ese código. Copia de nuevo el código desde Ajustes.';
  end if;

  select id into target_user_id
  from auth.users
  where lower(email) = lower(trim('PEGA_AQUI_EL_CORREO_DE_AINHOA'));

  if target_user_id is null then
    raise exception 'Ainhoa todavía no ha iniciado sesión. Debe abrir primero su enlace de acceso.';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (target_workspace_id, target_user_id, 'member')
  on conflict (workspace_id, user_id) do nothing;
end;
$$;

-- Al terminar sin error, Ainhoa solo tiene que recargar la aplicación.
