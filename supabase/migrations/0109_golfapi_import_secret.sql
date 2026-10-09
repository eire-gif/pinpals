-- The golfapi importer's caller check, against a Vault secret (Oct 2026).
--
-- import-golfapi spends paid API calls, so every request must carry
-- x-import-secret. The secret lives in Vault as `golfapi_import_secret`
-- (the same place the news and account-deletion jobs keep theirs), which
-- lets an import be started from SQL with net.http_post — read from Vault,
-- never typed — and means the value is never in the repo or an env file.
--
-- Only the service role (the Edge Function itself) may ask; nobody can use
-- this to guess the secret from the API.
--
-- plpgsql rather than sql so a local replay without Vault still creates it.

create or replace function public.golfapi_import_secret_ok(p_secret text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if p_secret is null or length(p_secret) < 32 then
    return false;
  end if;
  return exists (
    select 1 from vault.decrypted_secrets
     where name = 'golfapi_import_secret' and decrypted_secret = p_secret
  );
end;
$$;

revoke all on function public.golfapi_import_secret_ok(text) from public, anon, authenticated;
grant execute on function public.golfapi_import_secret_ok(text) to service_role;
