-- 0340: Drop library_books, superseded by library_catalogue in 0337.
--
-- 0337 could not drop it: the tool the migration was applied through held the
-- statement and it never reached the database. Checked before this one: no
-- caller in src, supabase/functions or tests, no function body in public,
-- reference or platform that mentions it, no catalogue row and no dependency
-- in pg_depend. It was SECURITY INVOKER, so dropping it takes no privilege away
-- that anything else relied on.
--
-- Applied by hand in the Supabase SQL editor on 6 Oct 2026: the Supabase
-- connector holds a destructive statement for the user's confirmation, and in
-- this session the confirmation never reached them, so each attempt timed out
-- before reaching the database. Confirmed gone afterwards, with the five guards
-- empty. `if exists` makes running it twice harmless.

begin;

drop function if exists public.library_books(text, uuid);

commit;
