-- 0204 — Eighty-seven indexes that answer nothing a longer one does not
--
-- Rule 1 puts `tenant_id` first on every table, and the convention that grew
-- around it put `x_tenant_idx ON (tenant_id)` on every table too. Then a
-- composite index arrived beside it — `(tenant_id, student_id)`,
-- `(tenant_id, session_id, attendance_date)`, a unique key — and from that
-- moment the single-column one answered nothing the longer one could not.
--
-- A btree on (a) is a *strict prefix* of a btree on (a, b): every seek the
-- short one serves, the long one serves too. That is not a heuristic and not a
-- linter's opinion — it is a property of the index structure, which is why this
-- migration can drop 87 indexes without reading a single query.
--
-- **And it is not a speedup, which is the part worth writing down.** The first
-- measurement here looked like one: inserting 300 register marks went 635.5 ms
-- before to 329.8 ms after, with the Insert node itself 209.7 → 91.1 ms. That
-- number is wrong. The audit trigger moved in the same trace, 342.4 → 183.7 ms,
-- and dropping an index on `attendance_records` cannot make `audit_log` faster —
-- so the whole difference was cache warmth between two cold-ish runs.
--
-- Measured properly, both variants in one warm session, four runs each, with the
-- two `attendance_records` indexes recreated inside the transaction for the
-- control:
--
--     with the indexes     96.3 / 102.0 / 108.6 ms   (best / avg / worst)
--     without them         92.4 / 105.7 / 136.8 ms
--
-- Indistinguishable, and nominally *slower* without them. Two redundant indexes
-- over 300 rows is 600 btree inserts — a few milliseconds inside a statement
-- whose real cost is elsewhere: the audit trigger is ~55% of it and the four FK
-- triggers most of the rest. So the justification for this migration is **not**
-- latency:
--
--   * it is **correctness of the schema** — a strict-prefix index is a claim
--     that two indexes are needed, and that claim is false;
--   * the write it removes **scales with the table**, so the saving is ~nothing
--     on 6,000 attendance rows and real on the 80,000 a real school writes each
--     year, where the redundant btrees are also competing for cache;
--   * 576 → 489 indexes, 15 MB of index for a 303-student school.
--
-- Quote the second table, never the first. A number measured with a broken
-- instrument is worse than no number, because it is a number people quote — and
-- this file nearly quoted a 48% improvement that was a warm cache.
--
-- Three things worth keeping in mind before adding to this list:
--
--   * **A partial index is not redundant with a full one.** `WHERE status =
--     'active'` makes it a different index over a different set of rows, and it
--     is usually much smaller. None are dropped here; the selection excludes
--     them, and excludes expression indexes for the same reason.
--   * **A unique index is never dropped**, whatever prefixes it — it is a
--     constraint wearing an index. All 87 below are covered by an index that is
--     *not* itself in this list, so there is no chain where two indexes cover
--     each other and both disappear.
--   * **The advisor is not the instrument.** Supabase's performance advisor
--     reported 103 unindexed foreign keys here; measured by asking whether any
--     index *starts with* one of the FK's columns, it is 55, and only 2 of those
--     sit on an `ON UPDATE CASCADE` path — both pointing at `reference.locales`,
--     a static table whose key never changes. Rule 4's composite-key device is
--     correctly indexed everywhere: the cascade from `exam_subjects` to `marks`
--     runs `Index Scan using marks_paper_idx`, not a sequential scan. Do not
--     "fix" the advisor's 103.

begin;

-- ---------------------------------------------------------------------------
-- The drops. Grouped by what covers them, so the reason survives the diff.
-- ---------------------------------------------------------------------------

-- (tenant_id) under a longer composite or unique key — 72 of the 87.
drop index if exists public.attendance_records_tenant_idx;
drop index if exists public.book_categories_tenant_idx;
drop index if exists public.book_issues_tenant_idx;
drop index if exists public.books_tenant_idx;
drop index if exists public.class_levels_tenant_idx;
drop index if exists public.class_rooms_tenant_idx;
drop index if exists public.document_sequences_tenant_idx;
drop index if exists public.enquiries_tenant_idx;
drop index if exists public.enquiry_follow_ups_tenant_idx;
drop index if exists public.enrolments_tenant_idx;
drop index if exists public.exam_components_tenant_idx;
drop index if exists public.exam_remarks_tenant_idx;
drop index if exists public.exam_results_tenant_idx;
drop index if exists public.exam_subjects_tenant_idx;
drop index if exists public.exams_tenant_idx;
drop index if exists public.fee_heads_tenant_idx;
drop index if exists public.fee_instalments_tenant_idx;
drop index if exists public.fee_structures_tenant_idx;
drop index if exists public.grading_schemes_tenant_idx;
drop index if exists public.guardian_student_tenant_idx;
drop index if exists public.guardians_tenant_idx;
drop index if exists public.holidays_tenant_idx;
drop index if exists public.homework_tenant_idx;
drop index if exists public.homework_submissions_tenant_idx;
drop index if exists public.hostel_allocations_tenant_idx;
drop index if exists public.hostel_rooms_tenant_idx;
drop index if exists public.hostels_tenant_idx;
drop index if exists public.import_rows_tenant_idx;
drop index if exists public.inventory_items_tenant_idx;
drop index if exists public.invoice_lines_tenant_idx;
drop index if exists public.invoices_tenant_idx;
drop index if exists public.item_categories_tenant_idx;
drop index if exists public.leave_requests_tenant_idx;
drop index if exists public.leave_types_tenant_idx;
drop index if exists public.ledger_entries_tenant_idx;
drop index if exists public.marks_tenant_idx;
drop index if exists public.members_tenant_idx;
drop index if exists public.notification_channel_settings_tenant_idx;
drop index if exists public.notification_deliveries_tenant_idx;
drop index if exists public.notification_preferences_tenant_idx;
drop index if exists public.notification_templates_tenant_idx;
drop index if exists public.notifications_tenant_idx;
drop index if exists public.payment_intents_tenant_idx;
drop index if exists public.payslip_lines_tenant_idx;
drop index if exists public.payslips_tenant_idx;
drop index if exists public.people_tenant_idx;
drop index if exists public.posting_rules_tenant_idx;
drop index if exists public.promotion_decisions_tenant_idx;
drop index if exists public.renewal_decisions_tenant_idx;
drop index if exists public.role_permissions_tenant_idx;
drop index if exists public.roles_tenant_idx;
drop index if exists public.route_stops_tenant_idx;
drop index if exists public.salary_structures_tenant_idx;
drop index if exists public.schedules_tenant_idx;
drop index if exists public.section_subjects_tenant_idx;
drop index if exists public.sections_tenant_idx;
drop index if exists public.settings_tenant_idx;
drop index if exists public.staff_tenant_idx;
drop index if exists public.staff_attendance_tenant_idx;
drop index if exists public.staff_salary_assignments_tenant_idx;
drop index if exists public.stock_movements_tenant_idx;
drop index if exists public.students_tenant_idx;
drop index if exists public.study_material_tenant_idx;
drop index if exists public.subjects_tenant_idx;
drop index if exists public.time_slots_tenant_idx;
drop index if exists public.timetable_entries_tenant_idx;
drop index if exists public.transport_assignments_tenant_idx;
drop index if exists public.transport_routes_tenant_idx;
drop index if exists public.vehicles_tenant_idx;
drop index if exists public.visitors_tenant_idx;
drop index if exists public.voucher_lines_tenant_idx;
drop index if exists public.weekends_tenant_idx;

-- Two- and three-column indexes that a longer unique key already covers. These
-- are the ones a reader is most likely to think are load-bearing, so each names
-- its cover.
drop index if exists public.attendance_records_tenant_enrolment_idx; -- attendance_records_unique_mark
drop index if exists public.enrolments_tenant_session_idx;           -- enrolments_tenant_id_session_id_student_id_key
drop index if exists public.exam_remarks_exam_idx;                   -- exam_remarks_tenant_id_exam_id_student_id_key
drop index if exists public.exam_results_exam_idx;                   -- exam_results_tenant_id_exam_id_student_id_key
drop index if exists public.exam_subjects_exam_idx;                  -- exam_subjects_tenant_id_exam_id_section_id_subject_id_key
drop index if exists public.fee_structures_lookup_idx;               -- fee_structures_tenant_id_session_id_class_level_id_fee_head_key
drop index if exists public.guardian_student_guardian_idx;           -- guardian_student_tenant_id_guardian_id_student_id_key
drop index if exists public.notification_preferences_user_idx;       -- notification_preferences_tenant_id_user_id_event_key_channe_key
drop index if exists public.payslips_run_idx;                        -- payslips_tenant_id_run_id_staff_id_key
drop index if exists public.promotion_decisions_run_idx;             -- promotion_decisions_tenant_id_run_id_student_id_key
drop index if exists public.renewal_decisions_run_idx;               -- renewal_decisions_tenant_id_run_id_student_id_key
drop index if exists public.role_permissions_role_idx;               -- role_permissions_tenant_id_role_id_permission_code_key
drop index if exists public.section_subjects_section_idx;            -- section_subjects_tenant_id_session_id_section_id_subject_id_key
drop index if exists public.timetable_entries_section_idx;           -- timetable_entries_section_slot_key
drop index if exists public.transport_routes_session_idx;            -- transport_routes_tenant_id_session_id_code_key

-- ---------------------------------------------------------------------------
-- ...and a guard, or it comes back.
--
-- The fourth executable check beside schema_guard_violations(),
-- privilege_guard_violations() and audit_guard_violations(). Same argument as
-- rule 9's: a convention people have to remember is a convention somebody
-- forgets, and the next `x_tenant_idx` will be added by hand beside a composite
-- index that already covers it.
-- ---------------------------------------------------------------------------

create or replace function public.index_guard_violations()
returns table (schema_name text, table_name text, index_name text, covered_by text)
language sql
stable
security invoker
set search_path = ''
as $$
  with ix as (
    select i.indexrelid, i.indrelid, c.relname as idxname, t.relname as tbl, n.nspname as sch,
           string_to_array(i.indkey::text, ' ')::int[] as keys,
           i.indisunique or i.indisprimary
             or exists (select 1 from pg_catalog.pg_constraint k where k.conindid = i.indexrelid)
             as protected,
           i.indpred is not null as partial,
           i.indexprs is not null as has_expr
    from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
    join pg_catalog.pg_class t on t.oid = i.indrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname in ('public', 'reference') and i.indisvalid
  )
  select distinct a.sch::text, a.tbl::text, a.idxname::text, b.idxname::text
  from ix a
  join ix b
    on a.indrelid = b.indrelid
   and a.indexrelid <> b.indexrelid
   and array_length(a.keys, 1) < array_length(b.keys, 1)
   and b.keys[1:array_length(a.keys, 1)] = a.keys
  -- A partial or expression index is a different index over a different set of
  -- rows, on neither side of the comparison. Only plain btrees are comparable
  -- by prefix, which is what makes an empty result mean something.
  where not a.protected and not a.partial and not a.has_expr
    and not b.partial and not b.has_expr
  order by 1, 2, 3;
$$;

comment on function public.index_guard_violations() is
  'Rule 1''s fourth guard: a plain index whose key columns are a strict prefix '
  'of another plain index on the same table answers nothing the longer one does '
  'not, and costs a write on every insert. An empty result is the passing state. '
  'Partial and expression indexes are excluded on both sides deliberately -- they '
  'are different indexes over different rows, and comparing them by prefix would '
  'make this check fire on indexes that are doing real work, which is how a check '
  'becomes one people learn to ignore.';

revoke all on function public.index_guard_violations() from public;
grant execute on function public.index_guard_violations() to authenticated;

commit;
