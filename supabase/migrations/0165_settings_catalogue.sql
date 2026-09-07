-- ---------------------------------------------------------------------------
-- Settings: a bag with seven keys and nothing that says what they are
-- ---------------------------------------------------------------------------
--
-- `public.settings` has been here since migration 0007 and it is the oldest
-- instance of rule 12 -- configuration as data rather than as branches. It is
-- also the instance that shows what rule 12 leaves out:
--
--   > A rules document needs a **schema**, or nobody knows which keys exist,
--   > what shape a value takes, or what a missing one means.
--
-- Two concrete consequences, one broken today and one waiting:
--
-- **`school.profile` is all null and there is no way to fill it in.** Every
-- field -- city, state, phone, address -- is null in both tenants, because
-- nothing in the application writes that key. That is not a cosmetic gap: it is
-- the reason migration `0136` had to strip `{{school.city}}` out of the shipped
-- transfer certificate. A school could not issue its own leaving certificate
-- with its own city on it, and the fix was to delete the city.
--
-- **A default written in five places is five answers.** `library.fine_per_day`
-- defaults to 2.00 in the seed row (`0026`), in `library_return_book`'s
-- coalesce (`0026`), in the overdue report's coalesce (`0044`), in the old
-- `library_return_book` signature (`0015`) and in `getFinePerDay()` in
-- TypeScript. Today they agree, so nobody is charged wrongly -- every reader
-- consults the tenant's row first. The cost is latent and it is the one
-- migration `0101` already paid once for document kinds: changing the default
-- means finding five copies, and the sixth reader somebody writes next year
-- will invent its own.
--
-- So: the `reference.reports` pattern, applied to configuration. The catalogue
-- describes each key as data, one function resolves a value, and `/settings`
-- renders any of them without being edited.
--
-- WHAT THIS TABLE MAY NOT HOLD
--
-- `settings` is readable by **every tenant member** -- a parent, a student --
-- by a policy that predates this migration and is correct: a fine rate and a
-- school address are not secrets. That makes the catalogue an invitation to add
-- `razorpay.key_secret` as a key, which would publish it to four hundred
-- families.
--
--   > **There is no `secret` value type, deliberately.** Provider credentials
--   > live on the Edge Functions (rule 6) and nowhere else. If a setting needs
--   > to be secret, it is not a setting.

create table reference.settings_catalog (
  key text primary key,
  label text not null,
  description text,
  module text not null,
  -- No 'secret'. See above -- the omission is the mechanism.
  value_type text not null check (value_type in (
    'text', 'number', 'boolean', 'email', 'url', 'object'
  )),
  -- For `object`, the sub-fields, each {name, label, type, help?}. The shapes
  -- described here are the ones already in the database: `library.fine_per_day`
  -- is `{"amount": 2.00}` rather than a bare number, and cataloguing it as an
  -- object keeps all five existing readers working. This migration writes down
  -- the schema that exists; it does not reshape it underneath a money path.
  fields jsonb not null default '[]'::jsonb,
  -- **The one place a default lives.** Every reader resolves through
  -- `setting_value`, so there is no second copy to forget.
  default_value jsonb not null,
  -- Whether leaving it unset is worth a sentence from `settings_problems()`.
  -- Not a constraint: a half-configured school must still work.
  is_required boolean not null default false,
  permission_code text not null default 'settings.manage',
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

-- Same posture as `reference.permissions` and `reference.reports`: global,
-- static, no tenant data, so RLS stays off and writes are revoked instead.
grant select on reference.settings_catalog to anon, authenticated;
revoke insert, update, delete on reference.settings_catalog from anon, authenticated;
revoke truncate, references, trigger, maintain
  on reference.settings_catalog from anon, authenticated;

comment on table reference.settings_catalog is
  'What each key in public.settings is, what shape it takes, and what it '
  'defaults to. Global and static -- a migration writes it, nobody else. There '
  'is deliberately no `secret` value type; see migration 0165.';

insert into reference.settings_catalog
  (key, label, description, module, value_type, fields, default_value, is_required, sort_order)
values
  (
    'school.profile',
    'School address and contact',
    'Printed on certificates, invoices and report cards. A certificate reading "Father''s Name: —" is a document a school has to apologise for, and the same is true of a blank address.',
    'School', 'object',
    '[
      {"name":"address_line1","label":"Address line 1","type":"text"},
      {"name":"address_line2","label":"Address line 2","type":"text"},
      {"name":"city","label":"City","type":"text"},
      {"name":"state","label":"State","type":"text"},
      {"name":"postal_code","label":"PIN code","type":"text"},
      {"name":"phone","label":"Phone","type":"text"},
      {"name":"email","label":"Email","type":"email"},
      {"name":"website","label":"Website","type":"url"}
    ]'::jsonb,
    '{"address_line1":null,"address_line2":null,"city":null,"state":null,"postal_code":null,"phone":null,"email":null,"website":null}'::jsonb,
    true, 10
  ),
  (
    'contact_email',
    'Main contact address',
    'Where replies to school email go.',
    'School', 'email', '[]'::jsonb, 'null'::jsonb, false, 20
  ),
  (
    'currency',
    'Currency',
    'The rupee is a fact about the money rather than about the reader, so this is not a language setting.',
    'School', 'text', '[]'::jsonb, '"INR"'::jsonb, false, 30
  ),
  (
    'academic_year_start_month',
    'Academic year starts in',
    'Month number, 1-12. April in most of India; September elsewhere.',
    'School', 'number', '[]'::jsonb, '4'::jsonb, false, 40
  ),
  (
    'library.fine_per_day',
    'Library fine per day',
    'Charged when a late book is returned, booked into the fee ledger against the student. The running amount before return is an estimate and is stored nowhere.',
    'Library', 'object',
    '[{"name":"amount","label":"Amount per day","type":"number"}]'::jsonb,
    '{"amount": 2.00}'::jsonb, false, 50
  ),
  (
    'fees.online_payments',
    'Online payments',
    'Switching this on only offers the button. The gateway credentials live on the Edge Functions and are never stored here.',
    'Fees', 'object',
    '[
      {"name":"enabled","label":"Offer online payment","type":"boolean"},
      {"name":"provider","label":"Provider","type":"text"}
    ]'::jsonb,
    '{"enabled": false, "provider": "razorpay"}'::jsonb, false, 60
  ),
  (
    'notifications.invoice_email',
    'Email a copy of every invoice',
    'Sends the school its own copy when an invoice is issued. Arrives switched off, like everything else that sends.',
    'Fees', 'object',
    '[
      {"name":"enabled","label":"Send a copy","type":"boolean"},
      {"name":"to","label":"Send it to","type":"email"}
    ]'::jsonb,
    '{"enabled": false, "to": null}'::jsonb, false, 70
  );
