-- Phase 1 tickets: every client concern, with thread and attachments.

create type public.ticket_channel as enum ('messenger','viber','whatsapp','email','call','visit');
create type public.ticket_status as enum ('open','in_progress','waiting_on_client','resolved','closed');

create table public.ticket_categories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null check (length(trim(name)) > 0),
  sort_order int not null default 100,
  is_active boolean not null default true
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                       -- TKT-2026-00001
  client_id uuid references public.clients,
  site_id uuid references public.client_sites,
  channel public.ticket_channel not null,
  category_id uuid not null references public.ticket_categories,
  subject text not null check (length(trim(subject)) > 0),
  description text not null default '',
  status public.ticket_status not null default 'open',
  owner_id uuid references public.profiles,
  due_at timestamptz,
  source text not null default 'manual' check (source in ('manual','messenger','whatsapp')),
  external_thread_id text,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  voided_at timestamptz,
  voided_by uuid references public.profiles,
  void_reason text,
  search tsvector generated always as (
    to_tsvector('simple', coalesce(code,'') || ' ' || coalesce(subject,'') || ' ' || coalesce(description,''))
  ) stored,
  check ((voided_at is null) = (void_reason is null))
);
create index tickets_client on public.tickets (client_id);
create index tickets_owner on public.tickets (owner_id);
create index tickets_status on public.tickets (status) where voided_at is null;
create index tickets_search on public.tickets using gin (search);
create unique index tickets_external_thread on public.tickets (source, external_thread_id)
  where external_thread_id is not null;

create table public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets,
  author_id uuid references public.profiles default auth.uid(),
  kind text not null default 'comment' check (kind in ('comment','system')),
  body text not null check (length(trim(body)) > 0),
  external_message_id text unique,
  created_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('simple', body)) stored
);
create index ticket_comments_ticket on public.ticket_comments (ticket_id, created_at);
create index ticket_comments_search on public.ticket_comments using gin (search);

create table public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets,
  comment_id uuid references public.ticket_comments,
  storage_path text unique not null,
  file_name text not null,
  mime_type text not null,
  size_bytes int not null check (size_bytes between 1 and 10485760),
  uploaded_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now()
);
create index ticket_attachments_ticket on public.ticket_attachments (ticket_id);

-- ------------------------------------------------------------------ rules
create trigger tickets_code before insert on public.tickets
  for each row execute function public.set_doc_code('TKT');
create trigger tickets_code_fixed before update on public.tickets
  for each row execute function public.code_is_fixed();

create function public.guard_ticket() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.voided_at is not null then
    raise exception 'A voided ticket cannot be changed';
  end if;
  if new.voided_at is not null then
    if (select auth.uid()) is not null and not public.has_perm('tickets.void') then
      raise exception 'You are not allowed to void tickets';
    end if;
    if length(trim(coalesce(new.void_reason, ''))) = 0 then
      raise exception 'A reason is required to void a ticket';
    end if;
    new.voided_at := now();
    new.voided_by := (select auth.uid());
  end if;
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.source := old.source;
    if new.status in ('resolved','closed') and old.status not in ('resolved','closed') then
      new.closed_at := now();
    elsif new.status not in ('resolved','closed') then
      new.closed_at := null;
    end if;
  end if;
  if new.site_id is not null and not exists (
       select 1 from public.client_sites s where s.id = new.site_id and s.client_id = new.client_id) then
    raise exception 'The site does not belong to this client';
  end if;
  return new;
end $$;
create trigger tickets_guard before insert or update on public.tickets
  for each row execute function public.guard_ticket();

-- Status, owner, due date and void changes are written into the thread.
create function public.ticket_change_to_thread() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  lines text[] := '{}';
  who text;
begin
  if new.status is distinct from old.status then
    lines := lines || format('Status: %s → %s', replace(old.status::text,'_',' '), replace(new.status::text,'_',' '));
  end if;
  if new.owner_id is distinct from old.owner_id then
    select full_name into who from public.profiles where id = new.owner_id;
    lines := lines || format('Owner: %s', coalesce(who, 'unassigned'));
  end if;
  if new.due_at is distinct from old.due_at then
    lines := lines || format('Due date: %s', coalesce(to_char(new.due_at at time zone 'Asia/Manila', 'Mon DD, YYYY'), 'none'));
  end if;
  if new.voided_at is not null and old.voided_at is null then
    lines := lines || format('Voided: %s', new.void_reason);
  end if;
  if array_length(lines, 1) > 0 then
    insert into public.ticket_comments (ticket_id, author_id, kind, body)
    values (new.id, (select auth.uid()), 'system', array_to_string(lines, E'\n'));
  end if;
  return null;
end $$;
revoke execute on function public.ticket_change_to_thread() from public, anon, authenticated;
create trigger tickets_change_to_thread after update on public.tickets
  for each row execute function public.ticket_change_to_thread();

-- --------------------------------------------------------------- security
alter table public.ticket_categories enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_comments enable row level security;
alter table public.ticket_attachments enable row level security;

create policy ticket_categories_read on public.ticket_categories for select to authenticated
  using (public.has_perm('tickets.read_all') or public.has_perm('tickets.read_own'));
create policy ticket_categories_insert on public.ticket_categories for insert to authenticated
  with check (public.has_perm('tickets.categories'));
create policy ticket_categories_update on public.ticket_categories for update to authenticated
  using (public.has_perm('tickets.categories')) with check (public.has_perm('tickets.categories'));

-- D7: all tickets for holders of tickets.read_all; otherwise tickets the user owns
-- or tickets of clients whose account the user owns.
create policy tickets_read on public.tickets for select to authenticated using (
  public.has_perm('tickets.read_all')
  or (public.has_perm('tickets.read_own') and (
        owner_id = (select auth.uid())
        or client_id in (select c.id from public.clients c where c.account_owner = (select auth.uid()))))
);
create policy tickets_insert on public.tickets for insert to authenticated with check (
  public.has_perm('tickets.write') and (
    public.has_perm('tickets.read_all')
    or (public.has_perm('tickets.read_own') and (
          owner_id = (select auth.uid())
          or client_id in (select c.id from public.clients c where c.account_owner = (select auth.uid())))))
);
create policy tickets_update on public.tickets for update to authenticated
  using (
    public.has_perm('tickets.write') and (
      public.has_perm('tickets.read_all')
      or (public.has_perm('tickets.read_own') and (
            owner_id = (select auth.uid())
            or client_id in (select c.id from public.clients c where c.account_owner = (select auth.uid())))))
  )
  with check (
    public.has_perm('tickets.write') and (
      public.has_perm('tickets.read_all')
      or (public.has_perm('tickets.read_own') and (
            owner_id = (select auth.uid())
            or client_id in (select c.id from public.clients c where c.account_owner = (select auth.uid())))))
  );

-- Comments and attachments follow the ticket (tickets RLS applies in the subquery).
-- No update or delete policy: a posted comment cannot be edited.
create policy ticket_comments_read on public.ticket_comments for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_id));
create policy ticket_comments_insert on public.ticket_comments for insert to authenticated
  with check (
    public.has_perm('tickets.write') and kind = 'comment' and author_id = (select auth.uid())
    and exists (select 1 from public.tickets t where t.id = ticket_id and t.voided_at is null)
  );

create policy ticket_attachments_read on public.ticket_attachments for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_id));
create policy ticket_attachments_insert on public.ticket_attachments for insert to authenticated
  with check (
    public.has_perm('tickets.write') and uploaded_by = (select auth.uid())
    and exists (select 1 from public.tickets t where t.id = ticket_id and t.voided_at is null)
  );

create trigger tickets_touch before update on public.tickets
  for each row execute function public.touch_updated_at();

create trigger ticket_categories_audit after insert or update or delete on public.ticket_categories
  for each row execute function public.audit_row();
create trigger tickets_audit after insert or update or delete on public.tickets
  for each row execute function public.audit_row();
create trigger ticket_comments_audit after insert or update or delete on public.ticket_comments
  for each row execute function public.audit_row();
create trigger ticket_attachments_audit after insert or update or delete on public.ticket_attachments
  for each row execute function public.audit_row();

revoke all on public.ticket_categories, public.tickets, public.ticket_comments,
  public.ticket_attachments from anon;
revoke delete, truncate on public.ticket_categories, public.tickets, public.ticket_comments,
  public.ticket_attachments from authenticated;
revoke update on public.ticket_comments, public.ticket_attachments from authenticated;

-- ----------------------------------------------------------------- search
-- Runs with the caller's rights, so RLS limits the results.
create function public.search_tickets(q text) returns setof public.tickets
language sql stable security invoker set search_path = '' as $$
  select t.* from public.tickets t
  where trim(q) <> '' and (
    t.search @@ websearch_to_tsquery('simple', q)
    or t.code ilike '%' || q || '%'
    or t.subject ilike '%' || q || '%'
    or exists (select 1 from public.ticket_comments c
               where c.ticket_id = t.id and c.search @@ websearch_to_tsquery('simple', q))
    or exists (select 1 from public.clients cl
               where cl.id = t.client_id and (cl.name ilike '%' || q || '%' or cl.code ilike '%' || q || '%'))
    or exists (select 1 from public.client_sites s
               where s.id = t.site_id and s.name ilike '%' || q || '%')
  )
  order by t.created_at desc
$$;
revoke execute on function public.search_tickets(text) from public, anon;
grant execute on function public.search_tickets(text) to authenticated;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-attachments', 'ticket-attachments', false, 10485760,
        array['image/jpeg','image/png','image/webp','application/pdf']);

-- Object path: <ticket_id>/<random>-<file name>. Access follows the ticket.
create policy ticket_files_read on storage.objects for select to authenticated using (
  bucket_id = 'ticket-attachments'
  and exists (select 1 from public.tickets t where t.id::text = (storage.foldername(name))[1])
);
create policy ticket_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'ticket-attachments'
  and public.has_perm('tickets.write')
  and exists (select 1 from public.tickets t
              where t.id::text = (storage.foldername(name))[1] and t.voided_at is null)
);

insert into public.ticket_categories (name, sort_order) values
  ('Delivery request', 10), ('Dehire / pull-out request', 20), ('Swap request', 30),
  ('Billing concern', 40), ('Damaged pallets / repair', 50), ('Pallet audit', 60),
  ('Inquiry / quotation', 70), ('Complaint', 80), ('Other', 90);
