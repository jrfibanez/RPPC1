-- GPS is required for every clock in, clock out and client visit.
-- NOT VALID: applies to all new and changed rows; records saved before this rule stay as they are.

alter table public.attendance_logs add constraint attendance_in_gps_required
  check (in_lat is not null and in_lng is not null) not valid;
alter table public.client_visits add constraint client_visits_gps_required
  check (lat is not null and lng is not null) not valid;

create or replace function public.guard_attendance() returns trigger
language plpgsql as $$
begin
  if old.clock_out_at is not null then
    raise exception 'This shift is already closed';
  end if;
  if (new.id, new.user_id, new.clock_in_at, new.clock_in_received_at)
       is distinct from (old.id, old.user_id, old.clock_in_at, old.clock_in_received_at)
     or new.in_lat is distinct from old.in_lat or new.in_lng is distinct from old.in_lng
     or new.in_accuracy_m is distinct from old.in_accuracy_m then
    raise exception 'Clock-in details cannot be changed';
  end if;
  if new.clock_out_at is null then
    raise exception 'A clock-out time is required';
  end if;
  new.clock_out_received_at := now();
  if (select auth.uid()) is not null and (select auth.uid()) <> old.user_id then
    -- Admin closing a forgotten shift: needs a reason, has no location.
    if length(trim(coalesce(new.close_reason, ''))) = 0 then
      raise exception 'A reason is required to close another person''s shift';
    end if;
    new.closed_by := (select auth.uid());
  else
    if (select auth.uid()) is not null and (new.out_lat is null or new.out_lng is null) then
      raise exception 'Location is required to clock out';
    end if;
    new.closed_by := null;
    new.close_reason := null;
  end if;
  return new;
end $$;
