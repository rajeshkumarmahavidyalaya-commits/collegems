-- 0340: Drop library_books, superseded by library_catalogue in 0337.
--
-- 0337 could not drop it: the tool the migration was applied through held the
-- statement and it never reached the database. Checked before this one: no
-- caller in src, supabase/functions or tests, no function body in public,
-- reference or platform that mentions it, no catalogue row and no dependency
-- in pg_depend. It was SECURITY INVOKER, so dropping it takes no privilege away
-- that anything else relied on.
--
-- Applied by hand in the Supabase SQL editor: the migration tool held this
-- DROP the same way it held 0337's (it never reached the database log, where
-- every other migration's statement appears). `if exists` makes running it
-- twice harmless.

begin;

drop function if exists public.library_books(text, uuid);

commit;
