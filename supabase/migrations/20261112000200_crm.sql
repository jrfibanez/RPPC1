-- Phase 1 CRM: clients (billed principals), sites, contacts.

create type public.accreditation_status as enum ('prospect','verified','accredited','suspended');
create type public.island_group as enum ('luzon','visayas','mindanao');

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                       -- CL-0001
  name text not null check (length(trim(name)) > 0),
  trade_name text,
  tin text,
  billing_address text,
  accreditation_status public.accreditation_status not null default 'prospect',
  is_accredited boolean generated always as (accreditation_status = 'accredited') stored,
  billing_cutoff_day int not null default 10 check (billing_cutoff_day between 1 and 28),
  account_owner uuid references public.profiles,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_owner on public.clients (account_owner);

create table public.client_sites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients,
  code text unique not null,                       -- CL-0001-S01
  name text not null check (length(trim(name)) > 0),
  address text,
  island_group public.island_group not null default 'luzon',
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index client_sites_client on public.client_sites (client_id);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients,
  site_id uuid references public.client_sites,
  name text not null check (length(trim(name)) > 0),
  position text,
  mobile text,
  email text,
  preferred_channel text check (preferred_channel in
    ('messenger','viber','whatsapp','email','call','visit')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_client on public.contacts (client_id);

-- ------------------------------------------------------------------- codes
create function public.set_client_code() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.code := 'CL-' || lpad(public.next_master_no('client')::text, 4, '0');
  return new;
end $$;

create function public.set_site_code() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  select code into c from public.clients where id = new.client_id;
  new.code := c || '-S' || lpad(public.next_master_no('site:' || new.client_id)::text, 2, '0');
  return new;
end $$;
revoke execute on function public.set_client_code() from public, anon, authenticated;
revoke execute on function public.set_site_code() from public, anon, authenticated;

create trigger clients_code before insert on public.clients
  for each row execute function public.set_client_code();
create trigger clients_code_fixed before update on public.clients
  for each row execute function public.code_is_fixed();
create trigger client_sites_code before insert on public.client_sites
  for each row execute function public.set_site_code();
create trigger client_sites_code_fixed before update on public.client_sites
  for each row execute function public.code_is_fixed();

-- ----------------------------------------------------- accreditation guard
-- Sales may move a client between prospect and verified. Only a holder of
-- clients.accredit may set or leave accredited / suspended.
create function public.guard_accreditation() returns trigger
language plpgsql as $$
declare
  was public.accreditation_status := case when tg_op = 'UPDATE' then old.accreditation_status else 'prospect' end;
begin
  if (select auth.uid()) is null then return new; end if;   -- migrations, seed, service tasks
  if new.accreditation_status is distinct from was
     and (new.accreditation_status in ('accredited','suspended') or was in ('accredited','suspended'))
     and not public.has_perm('clients.accredit') then
    raise exception 'Only Admin or Finance can change accreditation';
  end if;
  return new;
end $$;
create trigger clients_guard_accreditation before insert or update on public.clients
  for each row execute function public.guard_accreditation();

-- A site or contact must stay with its client.
create function public.client_id_is_fixed() returns trigger
language plpgsql as $$
begin
  if new.client_id is distinct from old.client_id then
    raise exception 'A record cannot be moved to another client';
  end if;
  return new;
end $$;
create trigger client_sites_client_fixed before update on public.client_sites
  for each row execute function public.client_id_is_fixed();
create trigger contacts_client_fixed before update on public.contacts
  for each row execute function public.client_id_is_fixed();

-- --------------------------------------------------------------- security
alter table public.clients enable row level security;
alter table public.client_sites enable row level security;
alter table public.contacts enable row level security;

create function public.can_write_client(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_perm('clients.write_all')
      or (public.has_perm('clients.write_own') and exists (
            select 1 from public.clients c
            where c.id = p_client and c.account_owner = (select auth.uid())))
$$;
revoke execute on function public.can_write_client(uuid) from public, anon;
grant execute on function public.can_write_client(uuid) to authenticated;

create policy clients_read on public.clients for select to authenticated using (
  public.has_perm('clients.read_all')
  or (public.has_perm('clients.read_own') and account_owner = (select auth.uid()))
);
create policy clients_insert on public.clients for insert to authenticated with check (
  public.has_perm('clients.write_all')
  or (public.has_perm('clients.write_own') and account_owner = (select auth.uid()))
);
create policy clients_update on public.clients for update to authenticated
  using (
    public.has_perm('clients.write_all') or public.has_perm('clients.accredit')
    or (public.has_perm('clients.write_own') and account_owner = (select auth.uid()))
  )
  with check (
    public.has_perm('clients.write_all') or public.has_perm('clients.accredit')
    or (public.has_perm('clients.write_own') and account_owner = (select auth.uid()))
  );

-- A holder of clients.accredit without write rights may change only the status.
create function public.guard_accredit_only() returns trigger
language plpgsql as $$
begin
  if (select auth.uid()) is null or public.can_write_client(old.id) then return new; end if;
  if (to_jsonb(new) - 'accreditation_status' - 'is_accredited' - 'updated_at')
     is distinct from (to_jsonb(old) - 'accreditation_status' - 'is_accredited' - 'updated_at') then
    raise exception 'You can only change the accreditation status of this client';
  end if;
  return new;
end $$;
create trigger clients_guard_accredit_only before update on public.clients
  for each row execute function public.guard_accredit_only();

-- Sites and contacts are visible when their client is visible (clients RLS applies).
create policy client_sites_read on public.client_sites for select to authenticated
  using (exists (select 1 from public.clients c where c.id = client_id));
create policy client_sites_insert on public.client_sites for insert to authenticated
  with check (public.can_write_client(client_id));
create policy client_sites_update on public.client_sites for update to authenticated
  using (public.can_write_client(client_id)) with check (public.can_write_client(client_id));

create policy contacts_read on public.contacts for select to authenticated
  using (exists (select 1 from public.clients c where c.id = client_id));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (public.can_write_client(client_id));
create policy contacts_update on public.contacts for update to authenticated
  using (public.can_write_client(client_id)) with check (public.can_write_client(client_id));

create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();
create trigger client_sites_touch before update on public.client_sites
  for each row execute function public.touch_updated_at();
create trigger contacts_touch before update on public.contacts
  for each row execute function public.touch_updated_at();

create trigger clients_audit after insert or update or delete on public.clients
  for each row execute function public.audit_row();
create trigger client_sites_audit after insert or update or delete on public.client_sites
  for each row execute function public.audit_row();
create trigger contacts_audit after insert or update or delete on public.contacts
  for each row execute function public.audit_row();

revoke all on public.clients, public.client_sites, public.contacts from anon;
revoke delete, truncate on public.clients, public.client_sites, public.contacts from authenticated;
