-- Phase 2.3 -- the register carries employed_days so the screen can show
-- "11 of 26 days employed" for a leaver rather than only the paid figure.
-- Dropped and recreated because the return signature changes.

drop function if exists public.payroll_register(uuid);

create or replace function public.payroll_register(p_run_id uuid)
returns table (
  payslip_id uuid,
  staff_id uuid,
  employee_code text,
  staff_name text,
  designation text,
  structure_name text,
  working_days numeric,
  employed_days numeric,
  paid_days numeric,
  lop_days numeric,
  gross_earnings numeric,
  total_deductions numeric,
  net_pay numeric,
  is_override boolean,
  note text,
  amount_paid numeric,
  has_left boolean
)
language sql
stable
set search_path = public, extensions
as $$
  select
    ps.id,
    ps.staff_id,
    s.employee_code,
    (p.first_name || ' ' || p.last_name)::text,
    s.designation,
    st.name,
    ps.working_days,
    ps.employed_days,
    ps.paid_days,
    ps.lop_days,
    ps.gross_earnings,
    ps.total_deductions,
    ps.net_pay,
    ps.is_override,
    ps.note,
    public.payroll_payslip_paid(ps.id),
    (s.date_of_leaving is not null and s.date_of_leaving <= (r.period_month + interval '1 month - 1 day')::date)
  from public.payslips ps
  join public.staff s on s.id = ps.staff_id
  join public.people p on p.id = s.person_id
  join public.payroll_runs r on r.id = ps.run_id
  left join public.staff_salary_assignments a
    on a.staff_id = ps.staff_id
   and a.effective_from <= (r.period_month + interval '1 month - 1 day')::date
   and (a.effective_to is null or a.effective_to >= r.period_month)
  left join public.salary_structures st on st.id = a.structure_id
  where ps.run_id = p_run_id
  order by s.employee_code
$$;

revoke all on function public.payroll_register(uuid) from public, anon;
grant execute on function public.payroll_register(uuid) to authenticated;
