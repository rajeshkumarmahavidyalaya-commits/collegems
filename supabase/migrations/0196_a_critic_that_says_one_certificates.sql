-- 0196 -- "1 certificates is dated ..."
--
-- `0195`'s critic labelled each table with a plural noun and then made the verb
-- agree with the count, which reads correctly for nine of the ten tables and
-- wrongly for the one with a single row in it. Observed, verbatim, on the demo
-- school:
--
--     1 certificates is dated between 7 Sep 2026 and 7 Sep 2026 ...
--     32 homework are dated between 30 Aug 2026 and 30 Aug 2026 ...
--     6000 register rows are dated between 5 Aug 2026 and 1 Sep 2026 ...
--
-- Three faults in three lines: a plural noun with a singular verb, an
-- uncountable noun counted, and a four-figure number with no thousands
-- separator. None of them is a bug in the sense of a wrong answer, and all
-- three are why a school stops reading a screen. `0195` shipped a critic whose
-- whole argument is that somebody has to act on it.
--
-- So each table carries **both** forms rather than a stem and a rule: English
-- plurals are not derivable (`entry`/`entries`, and `homework` has none), and a
-- pluraliser that is right nine times out of ten is the thing that produced the
-- line above.

create or replace function public.academics_filing_problems()
returns table (severity text, message text)
language sql
stable
set search_path = public, extensions
as $$
  with years as materialized (
    select id, name, start_date, end_date from public.academic_sessions
  ),
  misfiled as (
    select 'register row'::text as one, 'register rows'::text as many,
           r.session_id, r.attendance_date as on_date
    from public.attendance_records r join years y on y.id = r.session_id
    where r.attendance_date < y.start_date or r.attendance_date > y.end_date
    union all
    select 'staff register row', 'staff register rows', a.session_id, a.attendance_date
    from public.staff_attendance a join years y on y.id = a.session_id
    where a.attendance_date < y.start_date or a.attendance_date > y.end_date
    union all
    select 'invoice', 'invoices', i.session_id, i.issue_date
    from public.invoices i join years y on y.id = i.session_id
    where i.issue_date < y.start_date or i.issue_date > y.end_date
    union all
    select 'ledger entry', 'ledger entries', l.session_id, l.occurred_at::date
    from public.ledger_entries l join years y on y.id = l.session_id
    where l.occurred_at::date < y.start_date or l.occurred_at::date > y.end_date
    union all
    select 'journal voucher', 'journal vouchers', v.session_id, v.voucher_date
    from public.journal_vouchers v join years y on y.id = v.session_id
    where v.voucher_date < y.start_date or v.voucher_date > y.end_date
    union all
    select 'homework task', 'homework tasks', h.session_id, h.assigned_on
    from public.homework h join years y on y.id = h.session_id
    where h.assigned_on < y.start_date or h.assigned_on > y.end_date
    union all
    select 'book issue', 'book issues', b.session_id, b.issued_at::date
    from public.book_issues b join years y on y.id = b.session_id
    where b.issued_at::date < y.start_date or b.issued_at::date > y.end_date
    union all
    select 'stock movement', 'stock movements', m.session_id, m.happened_on
    from public.stock_movements m join years y on y.id = m.session_id
    where m.happened_on < y.start_date or m.happened_on > y.end_date
    union all
    select 'exam', 'exams', e.session_id, e.starts_on
    from public.exams e join years y on y.id = e.session_id
    where e.starts_on < y.start_date or e.ends_on > y.end_date
    union all
    select 'certificate', 'certificates', c.session_id, c.issued_on
    from public.certificates c join years y on y.id = c.session_id
    where c.issued_on < y.start_date or c.issued_on > y.end_date
  ),
  grouped as (
    select
      m.one, m.many,
      y.name as filed_under,
      y.end_date as filed_year_ends,
      count(*) as rows_wrong,
      min(m.on_date) as earliest,
      max(m.on_date) as latest
    from misfiled m
    join years y on y.id = m.session_id
    group by m.one, m.many, y.name, y.end_date
  )
  select
    'warning'::text,
    format(
      '%s %s %s dated %s but filed under %s, which ended on %s.%s',
      trim(to_char(g.rows_wrong, 'FM999,999,999')),
      case when g.rows_wrong = 1 then g.one else g.many end,
      case when g.rows_wrong = 1 then 'is' else 'are' end,
      -- One row, or a hundred all on the same morning, is not "between X and
      -- X". A range that repeats itself reads as a bug in the sentence.
      case when g.earliest = g.latest
        then 'on ' || to_char(g.earliest, 'FMDD Mon YYYY')
        else 'between ' || to_char(g.earliest, 'FMDD Mon YYYY')
             || ' and ' || to_char(g.latest, 'FMDD Mon YYYY')
      end,
      g.filed_under,
      to_char(g.filed_year_ends, 'FMDD Mon YYYY'),
      coalesce(
        ' They belong to ' || ( select y2.name from years y2
                                where g.earliest between y2.start_date and y2.end_date ) || '.',
        ' No year covers those dates.')
    )::text
  from grouped g

  union all

  select
    'warning'::text,
    format(
      'Rows are dated today and stamped with whichever year is current, and %s is current though it ended on %s. %s covers today -- make it current under Academics → Years.',
      cur.name, to_char(cur.end_date, 'FMDD Mon YYYY'), today.name
    )::text
  from public.academic_sessions cur
  join years today on current_date between today.start_date and today.end_date
  where cur.is_current
    and current_date > cur.end_date
    and today.id <> cur.id

  order by 2
$$;
