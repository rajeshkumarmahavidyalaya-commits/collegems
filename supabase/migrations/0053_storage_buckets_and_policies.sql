-- Storage: private buckets, and the one thing a path can actually enforce.
--
-- Rule 8 has described this since the first migration and nothing had needed it
-- until homework. Getting it right once matters more than the module does: this
-- is the shape every later upload copies.
--
-- WHAT STORAGE RLS CAN AND CANNOT DO
--
-- Policies on `storage.objects` see the object's *path* and nothing else. They
-- cannot join to `enrolments` to ask "is this student in the class this homework
-- was set for" -- the answer lives in `public`, and the file does not carry it.
--
-- So authorization is split, deliberately, and each half does the part it can:
--
--   Storage RLS   tenant isolation, from the first path segment. Coarse, but
--                 absolute: no object in another school's folder is reachable,
--                 whatever else goes wrong.
--   Server action row-level permission, checked against `public` before a
--                 signed URL is issued or an upload is accepted.
--
-- The path convention is therefore load-bearing, not cosmetic:
--
--   {tenant_id}/{owner_id}/{uuid}-{filename}
--
-- The first segment is the tenant. Everything below is addressing, not
-- security -- an attacker who guesses a colleague's homework id inside their
-- own school is stopped by the server action, not by the path.
--
-- NOTHING IS PUBLIC. Every bucket is private and every read goes through a
-- signed URL issued after a permission check. `people.photo_path` has said
-- "storage object path, not a public URL" since migration 0003; this is what
-- makes that true.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  -- 5 MB. A profile photograph that needs more than that is a photograph
  -- somebody should have resized.
  (
    'avatars', 'avatars', false, 5242880,
    array['image/jpeg', 'image/png', 'image/webp']
  ),
  -- 10 MB. Admission papers, transfer certificates, ID scans.
  (
    'documents', 'documents', false, 10485760,
    array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  ),
  -- 50 MB, and a wider list: a teacher's notes are as often a slide deck or a
  -- spreadsheet as a PDF.
  (
    'study-material', 'study-material', false, 52428800,
    array[
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'application/zip'
    ]
  ),
  -- 20 MB. A child photographing three pages of exercise book on a phone,
  -- which is what a homework submission actually is in this market.
  (
    'homework-submissions', 'homework-submissions', false, 20971520,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain']
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- The tenant boundary, expressed as a path
-- ---------------------------------------------------------------------------

-- `storage.foldername(name)` splits the object path; element 1 is the first
-- folder. Comparing it to the JWT's tenant is the storage equivalent of
-- `tenant_id = current_tenant_id()`, and it is the only rule a path can carry.
--
-- Wrapped in `( select ... )` so the helper is an InitPlan evaluated once per
-- statement rather than once per object, the same reason migration 0012 rewrote
-- every policy in `public`.
--
-- It lives in `public` rather than `storage` because `storage` is owned by
-- `supabase_storage_admin` and this role cannot create in it. Policies *on*
-- `storage.objects` are creatable; functions inside the schema are not.
create or replace function public.storage_object_tenant_matches(p_name text)
returns boolean
language sql
stable
set search_path = public, storage, extensions
as $$
  select (storage.foldername(p_name))[1] = ( select public.current_tenant_id() )::text
$$;

revoke all on function public.storage_object_tenant_matches(text) from public, anon;
grant execute on function public.storage_object_tenant_matches(text) to authenticated;

create policy "tenant members read their own school's objects" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('avatars', 'documents', 'study-material', 'homework-submissions')
    and public.storage_object_tenant_matches(name)
  );

-- Writes are narrowed by role as far as a path allows. Which *row* a file
-- belongs to is checked by the server action that accepts the upload -- see
-- `docs/modules/homework.md`.
create policy "staff write into their own school's folders" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('avatars', 'documents', 'study-material')
    and public.storage_object_tenant_matches(name)
    and ( select public.current_role_code() ) in ('admin', 'teacher', 'librarian', 'accountant')
  );

-- A submission is the one thing a student uploads, so students are allowed into
-- exactly that bucket and no other.
create policy "students and staff write submissions" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'homework-submissions'
    and public.storage_object_tenant_matches(name)
  );

create policy "staff replace their own school's objects" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('avatars', 'documents', 'study-material', 'homework-submissions')
    and public.storage_object_tenant_matches(name)
  )
  with check (
    bucket_id in ('avatars', 'documents', 'study-material', 'homework-submissions')
    and public.storage_object_tenant_matches(name)
  );

create policy "staff delete their own school's objects" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('avatars', 'documents', 'study-material', 'homework-submissions')
    and public.storage_object_tenant_matches(name)
  );
