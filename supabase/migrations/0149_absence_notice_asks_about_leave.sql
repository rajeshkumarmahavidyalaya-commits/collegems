-- ---------------------------------------------------------------------------
-- The absence notice asks about leave first
-- ---------------------------------------------------------------------------
--
-- Migration 0141's evening absence notice works and, on its own, is rude: a
-- family that told the school on Monday their daughter has chickenpox gets a
-- text every evening for a week saying she was absent.
--
-- > **A module that sends must ask the module that knows.** Otherwise a school
-- > spends its SMS credit telling parents things the parents told the school,
-- > and the messages that matter get read as noise.
--
-- The register is untouched. A child on approved leave is still *absent* — they
-- were not there — and rewriting the register from a leave approval is exactly
-- the edit an attendance record must not permit. What changes is only whether
-- the family is told something they already know.
--
-- The run row now separates the two reasons a matched child was not written to:
--
--   * on approved leave — deliberate, and the school wanted it;
--   * no family login — a gap, and the school might want to close it.
--
-- One number ("12 matched, 7 told") cannot distinguish those, and they call for
-- opposite responses.

create or replace function public.schedule_run(
  p_schedule_id uuid,
  p_occurrence_at timestamptz,
  p_max_recipients integer default 500
)
returns public.schedule_runs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_s public.schedules;
  v_tz text;
  v_local_date date;
  v_run public.schedule_runs;
  v_late_minutes integer;
  v_matched integer := 0;
  v_notified integer := 0;
  v_on_leave integer := 0;
  v_truncated boolean := false;
  v_row record;
  v_audience jsonb;
  v_cap integer := greatest(least(coalesce(p_max_recipients, 500), 2000), 1);
begin
  select * into v_s from public.schedules where id = p_schedule_id;
  if v_s.id is null then
    raise exception 'No such schedule';
  end if;

  select t.timezone into v_tz from public.tenants t where t.id = v_s.tenant_id;
  v_local_date := (p_occurrence_at at time zone v_tz)::date;

  insert into public.schedule_runs (tenant_id, schedule_id, occurrence_at, status)
  values (v_s.tenant_id, v_s.id, p_occurrence_at, 'running')
  on conflict (schedule_id, occurrence_at) do nothing
  returning * into v_run;

  if v_run.id is null then
    select * into v_run from public.schedule_runs
    where schedule_id = p_schedule_id and occurrence_at = p_occurrence_at;
    return v_run;
  end if;

  v_late_minutes := (extract(epoch from (now() - p_occurrence_at)) / 60)::integer;
  if v_late_minutes > v_s.grace_minutes then
    update public.schedule_runs
       set status = 'missed',
           finished_at = now(),
           note = format(
             'Not run: %s minutes late, and this schedule is only worth sending within %s. '
             'Nothing was sent, and nothing will be sent for this occurrence.',
             v_late_minutes, v_s.grace_minutes)
     where id = v_run.id
    returning * into v_run;
    return v_run;
  end if;

  begin
    if v_s.kind = 'attendance.absentees' then
      for v_row in
        select distinct
          e.student_id,
          (p.first_name || ' ' || p.last_name)::text as full_name
        from public.attendance_records ar
        join public.enrolments e on e.id = ar.enrolment_id
        join public.students st on st.id = e.student_id
        join public.people p on p.id = st.person_id
        where ar.tenant_id = v_s.tenant_id
          and ar.attendance_date = v_local_date
          and ar.status = 'absent'
        order by full_name
        limit v_cap + 1
      loop
        v_matched := v_matched + 1;
        if v_matched > v_cap then
          v_truncated := true;
          v_matched := v_cap;
          exit;
        end if;

        -- The family already told us. Counted, not silently dropped.
        if public.student_is_on_leave(v_s.tenant_id, v_row.student_id, v_local_date) then
          v_on_leave := v_on_leave + 1;
          continue;
        end if;

        v_audience := public.schedule_student_audience(v_s.tenant_id, v_row.student_id);
        continue when jsonb_array_length(v_audience -> 'user_ids') = 0;

        perform public.notify_send_for(
          v_s.tenant_id,
          'attendance.absent',
          format('%s was marked absent', v_row.full_name),
          format('%s was marked absent at school on %s.',
                 v_row.full_name, to_char(v_local_date, 'FMDD Mon YYYY')),
          v_audience,
          jsonb_build_object(
            'student_name', v_row.full_name,
            'date', to_char(v_local_date, 'FMDD Mon YYYY')
          ),
          v_s.channels,
          null,
          false
        );
        v_notified := v_notified + 1;
      end loop;

    elsif v_s.kind = 'fees.due_reminder' then
      for v_row in
        select d.student_id, d.full_name, d.balance
        from public.schedule_fee_defaulters(
          v_s.tenant_id,
          coalesce((v_s.params ->> 'min_amount')::numeric, 1)
        ) d
        limit v_cap + 1
      loop
        v_matched := v_matched + 1;
        if v_matched > v_cap then
          v_truncated := true;
          v_matched := v_cap;
          exit;
        end if;

        v_audience := public.schedule_student_audience(v_s.tenant_id, v_row.student_id);
        continue when jsonb_array_length(v_audience -> 'user_ids') = 0;

        perform public.notify_send_for(
          v_s.tenant_id,
          'fees.due_reminder',
          'Fees outstanding',
          format('%s has %s outstanding on their fee account.',
                 v_row.full_name, to_char(v_row.balance, 'FM9999999990.00')),
          v_audience,
          jsonb_build_object(
            'student_name', v_row.full_name,
            'amount', to_char(v_row.balance, 'FM9999999990.00')
          ),
          v_s.channels,
          null,
          false
        );
        v_notified := v_notified + 1;
      end loop;

    elsif v_s.kind = 'library.overdue' then
      for v_row in
        select
          bi.id as issue_id,
          m.student_id,
          b.title,
          bi.due_at,
          (v_local_date - bi.due_at) as days_over
        from public.book_issues bi
        join public.members m on m.id = bi.member_id
        join public.books b on b.id = bi.book_id
        where bi.tenant_id = v_s.tenant_id
          and bi.status = 'issued'
          and bi.due_at < v_local_date
          and (v_local_date - bi.due_at) >= coalesce((v_s.params ->> 'min_days_over')::integer, 1)
          and m.student_id is not null
        order by bi.due_at
        limit v_cap + 1
      loop
        v_matched := v_matched + 1;
        if v_matched > v_cap then
          v_truncated := true;
          v_matched := v_cap;
          exit;
        end if;

        v_audience := public.schedule_student_audience(v_s.tenant_id, v_row.student_id);
        continue when jsonb_array_length(v_audience -> 'user_ids') = 0;

        perform public.notify_send_for(
          v_s.tenant_id,
          'library.book_overdue',
          'Library book overdue',
          format('"%s" was due back on %s and is %s day(s) overdue.',
                 v_row.title, to_char(v_row.due_at, 'FMDD Mon YYYY'), v_row.days_over),
          v_audience,
          jsonb_build_object(
            'title', v_row.title,
            'due_at', to_char(v_row.due_at, 'FMDD Mon YYYY'),
            'days_over', v_row.days_over::text
          ),
          v_s.channels,
          null,
          false
        );
        v_notified := v_notified + 1;
      end loop;

    else
      raise exception 'Nothing implements the schedule kind %', v_s.kind;
    end if;

  exception when others then
    update public.schedule_runs
       set status = 'failed', finished_at = now(), note = left(sqlerrm, 500),
           matched = v_matched, notified = v_notified
     where id = v_run.id
    returning * into v_run;
    return v_run;
  end;

  update public.schedule_runs
     set status = 'done',
         finished_at = now(),
         matched = v_matched,
         notified = v_notified,
         note = nullif(trim(concat_ws(' ',
           case when v_truncated then format(
             'Stopped at %s, which is this run''s limit. Raise the limit or narrow '
             'the schedule -- the rest were not told.', v_cap) end,
           case when v_matched = 0 then 'Nothing matched, so nothing was sent.' end,
           -- The two reasons are named separately because they call for
           -- opposite responses: one is the school getting what it asked for,
           -- the other is a gap it might want to close.
           case when v_on_leave > 0 then format(
             '%s of %s were on approved leave, so their families were not told again.',
             v_on_leave, v_matched) end,
           case when v_matched - v_on_leave - v_notified > 0 then format(
             '%s had no family login to send to.', v_matched - v_on_leave - v_notified) end
         )), '')
   where id = v_run.id
  returning * into v_run;

  return v_run;
end;
$$;

revoke all on function public.schedule_run(uuid, timestamptz, integer) from public, anon, authenticated;
