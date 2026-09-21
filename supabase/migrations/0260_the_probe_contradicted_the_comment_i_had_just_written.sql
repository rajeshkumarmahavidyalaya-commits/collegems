-- 0260 -- Correcting `0259`'s comment, which claimed something the schema does
--         not do.
--
-- `0259` shipped `student_search` with this on it:
--
--   'INVOKER, so row-ownership RLS decides -- a class teacher finds the
--    children they teach.'
--
-- and the same sentence in its header. **It is false**, and the probe that was
-- meant to demonstrate it said so. A teacher login built in a rolled-back
-- transaction, attached as class teacher to a section with 27 enrolments:
--
--   table               this teacher   the college
--   students                     302           302
--   people                       872           872
--   guardian_student             555           555
--   enrolments                    27           302
--   attendance_records           500         6,000
--
-- So `enrolments` and `attendance_records` are row-scoped and `students`,
-- `people` and `guardian_student` are **tenant-wide for every staff role**.
-- That is rule 4's own refinement -- *the matrix does real work wherever RLS is
-- deliberately tenant-wide* -- and it is the existing design: `0183` looked
-- squarely at `people` and narrowed it for **families**, keeping staff.
--
-- ## Why the sentence was easy to write
--
-- `students` carries `teachers view own section students`, whose predicate is
-- exactly *"children in a section I am class teacher of"*. Reading the policy
-- list, that is what a teacher gets. It is not, because
-- `staff roles view students` is `current_role_code() = ANY(ARRAY['admin',
-- 'teacher','accountant','librarian'])` with no row predicate, and
--
-- > **RLS policies are OR-ed.** `0249` learned this from the other end -- a
-- > correct narrow policy beside an over-broad one is an alternative, never a
-- > restriction. The corollary is the part `0249` did not say: **the narrow
-- > policy still reads like a promise.** Its existence is a claim about the
-- > schema, and here two of them (`students` and `people` both carry one) are
-- > unreachable and have been since the module shipped.
--
-- ## What this migration does and does not do
--
-- It corrects the comment. **It does not narrow the policy**, and that is a
-- decision rather than an omission: a teacher reads the whole roll on the
-- class picker, the importer, ID cards, the fee counter and the register, and
-- taking that away is a security-relevant rewrite whose instrument is a probe
-- as all six seats -- which this file already says is not a tidy-up. What a
-- school wants a teacher to see is also a per-college decision, and
-- `role_permissions` is where a college expresses one.
--
-- The lesson is about the comment, not the policy:
--
-- > **Write down what the probe said, not what the design intended.** The
-- > sentence was written from the policy that matched the intention, and there
-- > was another policy on the same table.

begin;

comment on function public.student_search(text, integer) is
  'Students matching an admission number or a name, for a picker. INVOKER, so '
  'the policies decide -- which is the whole roll for the four staff roles '
  '(students is tenant-wide for them; only enrolments and attendance_records '
  'are row-scoped) and their own children for a guardian. Measured, not '
  'assumed: see migration 0260, which corrects 0259''s claim that a teacher is '
  'narrowed here. One round trip rather than two, bounded, totally ordered, '
  'and the term is a bound parameter rather than a fragment of a filter '
  'string.';

comment on function public.global_search(text, integer) is
  'Students, staff and books matching one term, for the command palette. '
  'INVOKER, so RLS decides the audience -- a guardian gets their own children '
  'and no staff; a teacher gets the whole roll, because students is '
  'tenant-wide for staff roles (migration 0260). One round trip rather than '
  'five, bounded per kind, and the term is a bound parameter rather than a '
  'fragment of a filter string. Returns values, not sentences: the subtitle '
  'and the path are the renderer''s, so both stay translatable and routable in '
  'TypeScript.';

commit;
