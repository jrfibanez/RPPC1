-- Phase 1 foundation: roles, profiles, permissions, audit log, numbering.

create type public.app_role as enum ('admin','sales','deployment_officer','driver',
  'production_officer','maker','painter','guard','hr','finance','purchasing','warehouse');

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users on delete restrict,
  full_name text not null check (length(trim(full_name)) > 0),
  login_email text not null,
  role public.app_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------- permissions
create table public.role_permissions (
  role public.app_role not null,
  permission text not null,
  primary key (role, permission)
);

-- Role of the signed-in user. Null when signed out or deactivated, which makes
-- every permission check fail.
create function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = (select auth.uid()) and p.is_active
$$;

create function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.role_permissions rp
    where rp.permission = p and rp.role = public.current_app_role()
  )
$$;

-- --------------------------------------------------------------- audit log
create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id text,
  action text not null,
  old_row jsonb,
  new_row jsonb,
  actor_id uuid,
  at timestamptz not null default now()
);
create index audit_log_table_row on public.audit_log (table_name, row_id);
create index audit_log_at on public.audit_log (at desc);

create function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
begin
  insert into public.audit_log (table_name, row_id, action, old_row, new_row, actor_id)
  values (tg_table_name, coalesce(n->>'id', o->>'id'), tg_op, o - 'search', n - 'search',
          (select auth.uid()));
  return null;
end $$;

create function public.audit_log_is_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function public.audit_log_is_append_only();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_is_append_only();

-- --------------------------------------------------------------- numbering
create table public.doc_sequences (
  series text not null,
  year int not null,
  last_no int not null default 0,
  primary key (series, year)
);

-- PREFIX-YYYY-NNNNN. Runs inside the inserting transaction: the row lock queues
-- concurrent inserts, and a failed insert rolls its number back.
create function public.next_doc_code(p_series text, p_at timestamptz default now())
returns text language plpgsql security definer set search_path = '' as $$
declare
  y int := extract(year from p_at at time zone 'Asia/Manila');
  n int;
begin
  insert into public.doc_sequences (series, year, last_no) values (p_series, y, 1)
  on conflict (series, year) do update set last_no = public.doc_sequences.last_no + 1
  returning last_no into n;
  return p_series || '-' || y || '-' || lpad(n::text, 5, '0');
end $$;

create table public.code_sequences (
  scope text primary key,
  last_no int not null default 0
);

create function public.next_master_no(p_scope text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into public.code_sequences (scope, last_no) values (p_scope, 1)
  on conflict (scope) do update set last_no = public.code_sequences.last_no + 1
  returning last_no into n;
  return n;
end $$;

-- BEFORE INSERT trigger: create trigger … execute function set_doc_code('TKT')
create function public.set_doc_code() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.code := public.next_doc_code(tg_argv[0]);
  return new;
end $$;

create function public.code_is_fixed() returns trigger
language plpgsql as $$
begin
  if new.code is distinct from old.code then
    raise exception 'The code of a record cannot be changed';
  end if;
  return new;
end $$;

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Users must not be able to burn numbers or call trigger helpers directly.
revoke execute on function public.next_doc_code(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.next_master_no(text) from public, anon, authenticated;
revoke execute on function public.set_doc_code() from public, anon, authenticated;
revoke execute on function public.audit_row() from public, anon, authenticated;
revoke execute on function public.current_app_role() from public, anon;
revoke execute on function public.has_perm(text) from public, anon;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.has_perm(text) to authenticated;

-- ---------------------------------------------------------------- security
alter table public.profiles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.audit_log enable row level security;
alter table public.doc_sequences enable row level security;
alter table public.code_sequences enable row level security;

-- Names and roles are needed to show owners and authors. No pay or contact data here.
create policy profiles_read on public.profiles for select to authenticated
  using (public.current_app_role() is not null);
create policy profiles_insert on public.profiles for insert to authenticated
  with check (public.has_perm('admin.users'));
create policy profiles_update on public.profiles for update to authenticated
  using (public.has_perm('admin.users')) with check (public.has_perm('admin.users'));

create policy role_permissions_read on public.role_permissions for select to authenticated
  using (role = public.current_app_role() or public.has_perm('admin.permissions'));
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check (public.has_perm('admin.permissions'));
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using (public.has_perm('admin.permissions'));

create policy audit_log_read on public.audit_log for select to authenticated
  using (public.has_perm('audit.read'));
-- doc_sequences / code_sequences: no policies. Only the numbering functions touch them.

-- Admin can never lose the keys to the system.
create function public.protect_admin_permissions() returns trigger
language plpgsql as $$
begin
  if old.role = 'admin' and old.permission in ('admin.users','admin.permissions','audit.read') then
    raise exception 'The admin role cannot lose the % permission', old.permission;
  end if;
  return old;
end $$;
create trigger role_permissions_protect_admin before delete on public.role_permissions
  for each row execute function public.protect_admin_permissions();

-- An admin cannot deactivate or demote their own account (no lock-out).
create function public.protect_own_profile() returns trigger
language plpgsql as $$
begin
  if old.id = (select auth.uid()) and (new.role <> old.role or new.is_active = false) then
    raise exception 'You cannot change your own role or deactivate yourself';
  end if;
  return new;
end $$;
create trigger profiles_protect_own before update on public.profiles
  for each row execute function public.protect_own_profile();

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function public.audit_row();
create trigger role_permissions_audit after insert or update or delete on public.role_permissions
  for each row execute function public.audit_row();

revoke all on public.profiles, public.role_permissions, public.audit_log,
  public.doc_sequences, public.code_sequences from anon;
revoke all on public.audit_log, public.doc_sequences, public.code_sequences from authenticated;
grant select on public.audit_log to authenticated;
revoke delete, truncate on public.profiles from authenticated;
revoke update, delete, truncate on public.audit_log from service_role;

-- ------------------------------------------------- default permission matrix
insert into public.role_permissions (role, permission)
select 'admin', p from unnest(array[
  'admin.users','admin.permissions','audit.read',
  'clients.read_all','clients.write_all','clients.accredit',
  'tickets.read_all','tickets.write','tickets.void','tickets.categories',
  'field.read_all','field.close_shift'
]) p;

insert into public.role_permissions (role, permission) values
  ('sales','clients.read_own'), ('sales','clients.write_own'),
  ('sales','tickets.read_own'), ('sales','tickets.write'),
  ('sales','field.use'),
  ('deployment_officer','clients.read_all'),
  ('deployment_officer','tickets.read_all'), ('deployment_officer','tickets.write'),
  ('deployment_officer','tickets.void'),
  ('finance','clients.read_all'), ('finance','clients.accredit'),
  ('finance','tickets.read_all'), ('finance','tickets.write');
