-- ---------------------------------------------------------------------------
-- Locale -- a property of a person, and of the school they are at
-- ---------------------------------------------------------------------------
--
-- WHY THE LOCALE IS NOT IN THE URL
--
-- The App Router's usual answer is a `[locale]` route segment, and for a public
-- site it is the right one: a search engine has to be able to index the Hindi
-- page separately, and a person has to be able to send somebody a link that
-- opens in the language they were reading.
--
-- Neither is true here. Every screen in this application is behind a login,
-- nothing is indexed, and a link shared between two members of staff should
-- open in *the reader's* language rather than the sender's. So the locale is a
-- property of the person, resolved server-side exactly as the tenant and the
-- session already are -- and `/students` stays `/students` in every language.
--
-- The cost is worth stating rather than discovering: there is no per-locale
-- caching by URL, so a shared cache in front of this app would have to vary on
-- the cookie. Nothing in this deployment does that today.
--
-- THE RESOLUTION ORDER, which lives in src/lib/i18n/locale.ts and is written
-- down here because the columns only make sense alongside it:
--
--   1. user_profiles.locale     what this person chose
--   2. the `locale` cookie      what they chose before signing in
--   3. Accept-Language          what their browser asked for
--   4. tenants.default_locale   what the school runs in
--   5. 'en'
--
-- Step 2 is what makes a login page usable by somebody who cannot read the
-- default: they have no profile yet, so the cookie is the only place a choice
-- can live.

alter table public.tenants
  add column default_locale text not null default 'en';

alter table public.user_profiles
  -- Null means "follow the school", which is different from having chosen the
  -- school's language: if the school switches to Hindi, somebody who never
  -- expressed a preference should switch with it, and somebody who explicitly
  -- chose English should not.
  add column locale text;

-- The set of locales is a fact about which message catalogues have been
-- written, so it lives in `reference` beside the other global catalogues --
-- outside `public`, which keeps the schema-guard invariant meaningful.
create table reference.locales (
  code text primary key,
  english_name text not null,
  native_name text not null,
  -- 'ltr' or 'rtl'. Carried as data rather than derived from the code, because
  -- the list of RTL languages is not something to reimplement from memory in
  -- every client that renders a document.
  direction text not null default 'ltr' check (direction in ('ltr', 'rtl')),
  is_enabled boolean not null default true,
  position integer not null default 0
);

revoke insert, update, delete on reference.locales from authenticated, anon;
grant select on reference.locales to authenticated, anon;

insert into reference.locales (code, english_name, native_name, direction, position) values
  ('en', 'English', 'English', 'ltr', 0),
  ('hi', 'Hindi',   'हिन्दी',   'ltr', 1),
  ('ur', 'Urdu',    'اردو',     'rtl', 2);

-- Both columns must name a locale that exists. A foreign key rather than a
-- CHECK, so adding a language is one INSERT rather than an ALTER -- the same
-- reasoning as `document_sequences.kind` in migration 0101, arrived at the
-- other way round.
alter table public.tenants
  add constraint tenants_default_locale_fkey
  foreign key (default_locale) references reference.locales (code) on update cascade;

alter table public.user_profiles
  add constraint user_profiles_locale_fkey
  foreign key (locale) references reference.locales (code) on update cascade;

-- ---------------------------------------------------------------------------
-- Choosing one
-- ---------------------------------------------------------------------------

-- `user_profiles` has no self-update policy: a person must not be able to
-- change their own `role_id` or `tenant_id`, which is the whole reason the
-- table is written by the signup trigger and by administrators. Locale is the
-- one column they genuinely own, so this is the definer-function case from
-- CLAUDE.md's "a column grant separates columns, not people" -- a GRANT would
-- widen it for administrators too, and the narrower party gets a function.
create or replace function public.set_my_locale(p_locale text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not signed in';
  end if;

  -- Null is a legitimate choice: it means "follow the school".
  if p_locale is not null and not exists (
    select 1 from reference.locales l where l.code = p_locale and l.is_enabled
  ) then
    raise exception 'This system has no messages in %', p_locale;
  end if;

  update public.user_profiles set locale = p_locale where id = v_user_id;
  return p_locale;
end;
$$;

revoke all on function public.set_my_locale(text) from public, anon;
grant execute on function public.set_my_locale(text) to authenticated;

-- What a client needs before it can render anything: which languages exist,
-- what they are called in themselves, and which way each one runs.
create or replace function public.available_locales()
returns table (
  code text,
  english_name text,
  native_name text,
  direction text,
  is_default boolean
)
language sql
stable
set search_path = public, extensions
as $$
  select
    l.code, l.english_name, l.native_name, l.direction,
    l.code = coalesce((
      select t.default_locale from public.tenants t
      where t.id = ( select public.current_tenant_id() )
    ), 'en')
  from reference.locales l
  where l.is_enabled
  order by l.position, l.code
$$;

revoke all on function public.available_locales() from public;
-- `anon` too: the login page has to offer a language before anybody has signed
-- in, and the list of languages is not a secret.
grant execute on function public.available_locales() to authenticated, anon;
