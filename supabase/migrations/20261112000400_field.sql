-- Phase 1 field work: clock in / clock out and client visits with stamped selfie.
-- Ids are generated on the phone so an offline record sent twice is stored once.

create table public.attendance_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles default auth.uid(),
  clock_in_at timestamptz not null,                -- phone time at the press
  clock_in_received_at timestamptz not null default now(),
  in_lat double precision check (in_lat between -90 and 90),
  in_lng double precision check (in_lng between -180 and 180),
  in_accuracy_m real,
  clock_out_at timestamptz,
  clock_out_received_at timestamptz,
  out_lat double precision check (out_lat between -90 and 90),
  out_lng double precision check (out_lng between -180 and 180),
  out_accuracy_m real,
  closed_by uuid references public.profiles,       -- set when Admin closes a forgotten shift
  close_reason text,
  check (clock_out_at is null or clock_out_at >= clock_in_at)
);
create unique index attendance_one_open_shift on public.attendance_logs (user_id)
  where clock_out_at is null;
create index attendance_user_day on public.attendance_logs (user_id, clock_in_at desc);

create table public.client_visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles default auth.uid(),
  client_id uuid not null references public.clients,
  site_id uuid references public.client_sites,
  purpose text not null check (length(trim(purpose)) > 0),
  notes text not null default '',
  photo_path text not null,                        -- visit-photos/<user_id>/<visit_id>.jpg
  captured_at timestamptz not null,                -- phone time when the selfie was taken
  received_at timestamptz not null default now(),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  accuracy_m real,
  ticket_id uuid references public.tickets
);
create index client_visits_user on public.client_visits (user_id, captured_at desc);
create index client_visits_client on public.client_visits (client_id, captured_at desc);

create function public.guard_attendance() returns trigger
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
    if length(trim(coalesce(new.close_reason, ''))) = 0 then
      raise exception 'A reason is required to close another person''s shift';
    end if;
    new.closed_by := (select auth.uid());
  else
    new.closed_by := null;
    new.close_reason := null;
  end if;
  return new;
end $$;
create trigger attendance_guard before update on public.attendance_logs
  for each row execute function public.guard_attendance();

alter table public.attendance_logs enable row level security;
alter table public.client_visits enable row level security;

create policy attendance_read on public.attendance_logs for select to authenticated using (
  public.has_perm('field.read_all')
  or (public.has_perm('field.use') and user_id = (select auth.uid()))
);
create policy attendance_insert on public.attendance_logs for insert to authenticated with check (
  public.has_perm('field.use') and user_id = (select auth.uid())
  and clock_out_at is null and closed_by is null
);
create policy attendance_update on public.attendance_logs for update to authenticated
  using (
    public.has_perm('field.close_shift')
    or (public.has_perm('field.use') and user_id = (select auth.uid()))
  )
  with check (
    public.has_perm('field.close_shift')
    or (public.has_perm('field.use') and user_id = (select auth.uid()))
  );

create policy client_visits_read on public.client_visits for select to authenticated using (
  public.has_perm('field.read_all')
  or (public.has_perm('field.use') and user_id = (select auth.uid()))
);
-- The client must be one the user can see (clients RLS applies in the subquery).
create policy client_visits_insert on public.client_visits for insert to authenticated with check (
  public.has_perm('field.use') and user_id = (select auth.uid())
  and exists (select 1 from public.clients c where c.id = client_id)
  and photo_path = (select auth.uid())::text || '/' || id::text || '.jpg'
);

create trigger attendance_audit after insert or update or delete on public.attendance_logs
  for each row execute function public.audit_row();
create trigger client_visits_audit after insert or update or delete on public.client_visits
  for each row execute function public.audit_row();

revoke all on public.attendance_logs, public.client_visits from anon;
revoke delete, truncate on public.attendance_logs, public.client_visits from authenticated;
revoke update on public.client_visits from authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visit-photos', 'visit-photos', false, 2097152, array['image/jpeg']);

-- Object path: <user_id>/<visit_id>.jpg
create policy visit_photos_read on storage.objects for select to authenticated using (
  bucket_id = 'visit-photos' and (
    public.has_perm('field.read_all')
    or (public.has_perm('field.use') and (storage.foldername(name))[1] = (select auth.uid())::text))
);
create policy visit_photos_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'visit-photos' and public.has_perm('field.use')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
