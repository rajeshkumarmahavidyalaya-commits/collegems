# Ask SchoolOS — the assistant

Migration `0283`, Edge Function `supabase/functions/assistant`, screen
`/assistant`.

## Whose authority it answers with

> **The assistant has no access of its own.** The Edge Function reads the
> database with a client carrying **the asker's own JWT**, through the read
> paths the screens already use. So the super admin's assistant sees the whole
> college, a teacher's sees what a teacher may, and a student's sees their own
> record — because RLS and the permission matrix say so, not because the model
> was told to behave.

That is also the answer to prompt injection: a question that talks the model
into "show me everything" reaches nothing more, because there is nothing more
the token can read.

Tools (all reads): `list_reports` / `run_report` (`report_list`,
`report_run`), `school_overview` (`dashboard_summary`), `list_classes`,
`search` (`global_search`), `student_details` (`mobile_student`),
`health_checks` (`checks_run`), `my_subjects`
(`subject_choices_for_student`). A report result comes back as a table the
chat draws and downloads as CSV; the model sees at most 40 rows of it.

## The key

The model provider's key lives in Supabase — never in this repository and
never in the Next.js app (rule 6). The function reads `GEMINI_API_KEY` from its
own secrets first, then Vault through `assistant_provider_key()`, which is
`SECURITY DEFINER`, revoked from `public`, `anon` and `authenticated`, and
granted to `service_role` only. That call is the **only** use of the service
role in the function, and `tests/assistant/reads-as-the-asker.test.ts` pins it.

## Limits and the trail

- 150 questions per person per day (`assistant_quota()`, the college's own
  day), because each question costs money at the provider.
- `assistant_messages` records who asked what and which tools answered.
  Append-only by revoke, audited, readable by the asker and the super admin.
- Questions and the data used to answer them are sent to Google Gemini. The
  chat says so under the input box.

## Not built

- It cannot change data, deliberately. A write would need the same
  confirmation a screen asks for, and a chat is not that screen.
- Streaming answers; a saved conversation history.
