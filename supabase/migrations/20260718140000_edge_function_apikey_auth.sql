-- Section 1's cron wiring assumed a custom "x-cron-secret" header. Building
-- the actual Edge Functions (section 5) surfaced that the current Supabase
-- Edge Functions convention (the `@supabase/server` / `withSupabase` helper
-- the CLI scaffolds by default) authenticates server-to-server calls via the
-- standard `apikey` header checked against the project's own secret API key
-- — there's no need for a separate invented secret. This migration updates
-- the invoker to match: same vault-secret indirection, different header and
-- vault secret name (`edge_function_secret_key` instead of `cron_secret`,
-- holding the project's real `sb_secret_...` key, not an arbitrary string).

create or replace function private.invoke_edge_function(function_name text, payload jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_project_url text;
  v_secret_key text;
begin
  select decrypted_secret into v_project_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret_key from vault.decrypted_secrets where name = 'edge_function_secret_key';

  if v_project_url is null or v_secret_key is null then
    raise warning 'private.invoke_edge_function: vault secrets "project_url"/"edge_function_secret_key" not set yet, skipping call to %', function_name;
    return;
  end if;

  perform net.http_post(
    url := v_project_url || '/functions/v1/' || function_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_secret_key),
    body := payload
  );
end;
$$;
