-- ---------------------------------------------------------------------------
-- A default template must be issuable on the day it is installed
-- ---------------------------------------------------------------------------
--
-- The transfer certificate seeded by 0135 ended *"Issued at {{school.city}} on
-- {{date.issued}}"*, which is what a leaving certificate normally says and
-- which no school can issue until somebody has filled in the school profile.
-- The first attempt on the demo tenant refused, correctly and unhelpfully:
--
--   Nothing filled {{school.city}}.
--
-- The refusal is the module working. The template is the mistake, and it is the
-- same one 0135's own header warned about two paragraphs earlier: `school.city`
-- was left in for exactly the reason `student.address` was taken out, and the
-- reasoning simply was not carried across the file.
--
-- > **A seeded default may only use values the database is guaranteed to have.**
-- > Everything else is the school's to add once, deliberately, to their own copy
-- > of the wording -- which is what makes it a template rather than a form.
--
-- `{{school.city}}` remains a placeholder the engine fills; it is just not in
-- anything that ships. A school that fills in `school.profile` -- the same
-- setting the invoice letterhead reads -- can put it back in one edit.
--
-- Only untouched copies are rewritten. A school that has already adjusted its
-- own transfer certificate owns that wording now, and a migration silently
-- rewriting it would be worse than the bug.

update public.certificate_templates
   set body = replace(body,
         'Issued at {{school.city}} on {{date.issued}}.',
         'Issued on {{date.issued}}.')
 where kind = 'transfer'
   and name = 'Transfer Certificate'
   and body like '%Issued at {{school.city}} on {{date.issued}}.%';
