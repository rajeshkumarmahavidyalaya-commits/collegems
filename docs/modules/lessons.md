# Lessons, chapters and subject types (0347)

The reference has SM Lessons (Chapters and Lessons), Subject Types and
"Assign Subject in Bulk". This product half had all three.

## A chapter is a syllabus unit

The reference's chapter is a title for a class and a subject. That has existed
since the syllabus module as `syllabus_units`, per year, class and subject,
ordered, with coverage. So "Chapter's" on `/lessons` opens the syllabus
instead of starting a second list of the same thing.

## A lesson is study material in a chapter

A reference lesson is a title, a file or a link, and a description, placed in
a chapter. That is `study_material` with `unit_id`. A separate lessons table
would have been a second upload path and a second set of policies free to
disagree with the first (rule 12, *who else does this?*).

- **The chapter is the material's own subject**: a composite key carries
  `subject_id` into `(tenant_id, unit_id, subject_id) -> syllabus_units`
  (rule 4's device). A lesson filed under another subject's chapter cannot be
  written; the action turns the key error into a sentence.
- **The chapter is the material's own class and year**, two tables away
  (section -> class level), so a trigger checks it and says so. A plain
  insert through PostgREST routes around any function (0205).
- **Deleting a chapter keeps the uploads**: `on delete set null (unit_id)`
  turns its lessons back into plain study material.

`/lessons` lists this year's lessons, searchable and filtered by subject.
Staff add them through the study material dialog in lesson mode, with a
chapter list that follows the class and subject chosen. A family reads the
published lessons of their own class through the existing study material
policy.

## Subject types are a label; kind is a rule

`subject_types` is a short list a college writes, like mediums and houses
(0328), and `subjects.subject_type_id` points at it. `subjects.kind` (theory
or practical) stays, because the timetable and mark sheets read it. A type is
a label a college chooses; a kind is a rule the product enforces.

## Assign Subject in Bulk

`academics_assign_subjects(subjects, classes)` gives every chosen subject to
every chosen class this year in one transaction. An assignment that exists
keeps its teacher, and the answer counts both. INVOKER, with the
administrator check said before the insert (rule 6). Capped at 2,000 pairs.

Probed (rolled back) as the Annex administrator and teacher:

- a lesson in its own chapter was written;
- one in another subject's chapter was refused by the key (23503), and one in
  another class's chapter by the trigger, in a sentence;
- a lesson with no class was refused;
- a duplicate type ignoring case was refused (23505);
- the teacher's bulk assignment was refused in a sentence.

Walked in the browser:

- the administrator added a type, gave English that type, and bulk-assigned
  two subjects to a class that had both ("0 added; 2 were already there");
- the administrator added a link lesson under "Unit 1: Prose" and found it
  by search;
- the Annex student saw the published lesson, with no Add button, and
  Lessons in their menu.
