# RPPC Ops — System Specification

Status: **draft for approval** · 2026-11-12
Owner: Red Pallet Provider Co. (RPPC) · Scope: full system, Phases 1–6

This is the design for the whole system. Each phase gets its own plan
(`docs/PLAN-phase-N.md`) and is built and accepted before the next one starts.

---

## 1. Purpose and success criteria

RPPC Ops replaces the Excel files, hand-typed documents and chat threads that run
RPPC's pallet rental operation with one web app.

The system is successful when:

1. No client concern is lost: every Messenger, Viber, WhatsApp, email, call or visit
   concern is a ticket with an owner, a due date and a visible age.
2. Every delivery has an explicit pallet size on every line, and one numbered set of
   documents (trip ticket, DR, gate pass, petty cash voucher).
3. The monthly billing summary per client site is computed by the system from signed
   DRs and returns, not retyped.
4. Production counts are entered once, approved once, and flow into weekly pay.
5. Every change is attributable: who, what, before, after, when.
6. A user can only see and do what their role allows, enforced in the database.

## 2. Decisions already made

From the brief and the Q&A of 2026-11-12.

| # | Decision |
|---|---|
| D1 | Rent counts both the delivery day and the return day (`batchRent` as given). |
| D2 | Billing period for cutoff day C runs from day C+1 of the previous month to day C. Default C = 10, so 11th to 10th. |
| D3 | A return stops rent on the returned quantity only, from the return date. The rest of the site's pallets keep billing. See §8.5. |
| D4 | The daily rate is stored per proposal/contract line (site + pallet size + pallet type). A renewal rate applies from its start date. |
| D5 | Rates and delivery fees are stored VAT-exclusive. The billing summary shows subtotal, 12% VAT and total. The official invoice still comes from SAP. |
| D6 | Pallets already at client sites enter the system as opening balances taken from the "2026 Transaction Logs" sheet. See §8.7. |
| D7 | Admin, Deployment Officer and Finance see all tickets. Sales sees tickets for own accounts or tickets they own. Other roles see none. |
| D8 | Login is always email + password. A worker with a real email uses it. A worker without one gets a generated login such as `w-0001@rppc.local`. Password resets are done by Admin. |
| D9 | Offline queue covers field actions only: proof of delivery, daily output logging, gate pass check-out/in, and (new) clock in/out and client visit selfie. Office screens need a connection. |
| D10 | Renewal alerts are in-app only (dashboard and bell). No email sending. |
| D11 | "Mobile onsite" is a repair service done at the client's site so the client does not have to swap pallets using their own trucks. The order type is scheduled and recorded. Its billing stays deferred. |
| D12 | Branding (logo, red/charcoal colours) comes from the Company Profile v4. Proposal and contract wording is still needed before Phase 2 is accepted. |
| D13 | Development and tests run against a local Supabase stack. Nothing is deployed to the cloud until the owner says so. Cloud region will be Singapore. |
| D14 | Code lives in GitHub `jrfibanez/RPPC1`. |
| D15 | **Added to Phase 1:** field clock in / clock out, and client visit selfie with timestamp and GPS. See §7.4. |

## 3. Out of scope

Not built in any phase: mobile onsite repair **billing**, live SAP integration, truck
GPS tracking screens, pallet pooling, statutory payroll (SSS, PhilHealth, Pag-IBIG,
tax), live chat integration with Messenger/WhatsApp, email or SMS sending, 2FA,
self-signup.

## 4. Architecture

```
Phone / desktop browser (installable PWA)
   │  HTTPS
Next.js on Vercel ── Server Actions (Zod validation) ── PDF + CSV/XLSX generation
   │  user's own session (never a master key for normal work)
Supabase ── Postgres (RLS, triggers, sequences, audit) · Auth · private Storage
```

- **Next.js App Router, TypeScript.** Pages read data on the server with the signed-in
  user's session. Every change goes through a Server Action that validates input with
  a Zod schema before touching the database.
- **The database is the security boundary.** Row Level Security is on for every table
  and denies by default. The UI hides what a role cannot use, but hiding is never the
  control.
- **Service-role key** is used in exactly one place: the admin-only action that
  creates or deactivates user accounts. It lives only in server environment variables.
- **Business rules that must not be bypassed live in Postgres**: document numbering,
  audit logging, void-instead-of-delete, status transitions that move money or stock.
- **Pure TypeScript modules** for calculations (`batchRent`, billing period, piece-rate
  pay) so they can be unit-tested without a database.
- **PDFs** are rendered on the server from one template per document type
  (`@react-pdf/renderer`). **Exports** are CSV and XLSX.
- **Dates and money.** Timestamps are stored as `timestamptz`. Business dates (DR
  received date, return date, output date) are `date` values in Asia/Manila. Money is
  `numeric(14,2)`; daily rates are `numeric(10,4)`. Line amounts are rounded half-up
  to the centavo; totals are sums of rounded lines.

### 4.1 Code layout

```
app/(auth)/login
app/(office)/…          desktop-first screens per module
app/(field)/…           phone-first screens: big buttons, one task per screen
lib/domain/…            pure calculation and rule modules (unit-tested)
lib/validation/…        Zod schemas, shared by forms and Server Actions
lib/intake/…            ticket intake interface and adapters
lib/offline/…           IndexedDB queue and sync
lib/pdf/…               document templates
supabase/migrations/…   all schema, policies, triggers
supabase/seed.sql       fake clients, sites, workers, users per role
tests/unit · tests/rls · tests/e2e
```

### 4.2 PWA and offline queue

- Installable (manifest + service worker). The app shell and the field screens are
  cached so they open without signal.
- A field action taken offline is saved in the phone's IndexedDB with a
  client-generated UUID, the device time, and GPS. It shows as "Waiting to send".
- When signal returns the queue is sent in order. The UUID makes the send
  idempotent: sending twice creates one record. The server stores both the device
  capture time and the time it received the record.
- Photos are compressed on the phone before queuing (long edge 1280 px, JPEG, target
  under 300 KB) and stamped with date, time and GPS coordinates on the image itself.
- A rejected item (for example the trip was cancelled meanwhile) stays in the queue
  marked "Needs attention" with the reason. Nothing is dropped silently.

## 5. Security model

### 5.1 Roles

`admin, sales, deployment_officer, driver, production_officer, maker, painter, guard,
hr, finance, purchasing, warehouse`. Helpers use the `driver` role. Each user has one
role. Only Admin creates, deactivates or changes users.

### 5.2 Permissions without redeploying

```sql
create table role_permissions (
  role app_role not null,
  permission text not null,          -- e.g. 'tickets.read_all', 'vouchers.approve'
  primary key (role, permission)
);
-- has_perm('tickets.read_all') → boolean, for the signed-in user (security definer, stable)
```

RLS policies call `has_perm(...)` and, where needed, add an ownership rule ("own
accounts", "own trips", "own output"). Admin edits the matrix on a settings screen.
Two guards: the `admin` role cannot lose user management or permission editing, and
the pay-privacy and payroll-visibility rules in §5.4 are written directly into the
policies, so no permission setting can loosen them.

### 5.3 Default permission matrix

R = read, W = create/edit, A = approve/release. "own" = limited by ownership.

| Area | admin | sales | deploy | driver | prod | maker/painter | guard | hr | finance | purch | whse |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Users, permissions, audit log | RW | – | – | – | – | – | – | – | – | – | – |
| Clients, sites, contacts | RW | RW own | R | – | – | – | – | – | R | – | – |
| Accreditation status | A | – | – | – | – | – | – | – | A | – | – |
| Tickets | RW | RW own | RW | – | – | – | – | – | RW | – | – |
| Clock in/out, client visits | R all | RW own | RW own | – | – | – | – | – | – | – | – |
| Proposals, contracts | RW | RW own | R | – | – | – | – | – | R | – | – |
| Sales orders | RW | RW own | R | – | R | – | – | – | R | – | – |
| Delivery schedule | RW | R | RW | R own | R | – | R | – | R | – | R |
| Trip ticket, DR, gate pass | RW | R own | RW | R own | – | – | R | – | R | – | – |
| Proof of delivery | R | R own | R | W own | – | – | – | – | R | – | – |
| Gate check-out / check-in | R | – | R | – | – | – | W | – | – | – | – |
| Petty cash voucher | A approve | – | W | R own | – | – | – | – | A release | – | – |
| Zone matrix | RW | R | RW | – | – | – | – | – | R | – | – |
| Billing summaries | RW | R own | RW | – | – | – | – | – | RW | – | – |
| Daily output | R | – | – | – | A | W own | verify | R | R | – | – |
| Workers, piece rates | R | – | – | – | R | – | – | RW | R | – | – |
| Payroll runs | A final | – | – | – | A 1st | R own payslip | – | A 2nd | A 3rd | – | – |
| Pallet stock, materials | R | R | R | – | R | – | – | – | R | R | RW |
| Suppliers, PR, PO, receiving | A (PR) | – | – | – | W (PR) | – | – | – | R | RW | W (receive) |
| SAP exports | R | – | – | – | – | – | – | – | RW | R (PO) | – |

### 5.4 Fixed rules

- RLS enabled and default-deny on every table. No table is readable by the
  anonymous key.
- A worker can read only their own pay lines and payslips. Sales cannot read any
  payroll table. Both are tested per role.
- **Append-only audit log.** A trigger on every business table writes
  `audit_log(table_name, row_id, action, old_row jsonb, new_row jsonb, actor_id, at)`.
  No role, including Admin, has update or delete on `audit_log`. Only Admin can read it.
- **No hard deletes of documents.** Document tables have no delete policy. A document
  is voided (`voided_at`, `voided_by`, `void_reason`, reason required). A voided code
  is never reused.
- **Private Storage buckets** (`ticket-attachments`, `visit-photos`, `signed-docs`,
  `pod-photos`). Storage policies mirror access to the parent record. Files are
  served through short-lived signed URLs.
- Secrets only in environment variables. `.env*` is git-ignored; `.env.example` lists
  names without values.
- Server Actions re-check the session and validate with Zod even though RLS would
  also refuse.

## 6. Codes and numbering

Document codes: `PREFIX-YYYY-NNNNN`, sequential per series per year (year in
Asia/Manila).

`PRP` proposal · `CTR` contract · `SO` sales order · `TT` trip ticket · `DR` delivery
receipt · `GP` gate pass · `PCV` petty cash voucher · `BS` billing summary · `TKT`
ticket · `PR` purchase request · `PO` purchase order · `PAY` payroll run

```sql
create table doc_sequences (
  series text not null, year int not null, last_no int not null default 0,
  primary key (series, year)
);
-- next_doc_code('TKT'): upsert … set last_no = last_no + 1 returning, inside the
-- inserting transaction. Called only from a BEFORE INSERT trigger; users cannot
-- supply or change a code.
```

The row lock makes concurrent inserts wait their turn. If the insert fails, the
counter rolls back with it, so the only gaps are voided documents.

Master data codes use the same mechanism without a year: clients `CL-0001`, sites
`CL-0001-S01` (numbered within the client), workers `W-0001`, trucks `TRK-01`.

## 7. Phase 1 — CRM, client concerns, field attendance

### 7.1 Clients, sites, contacts

- **Client** = the billed principal: code, legal name, trade name, TIN, billing
  address, account owner (a sales user), billing cutoff day (1–28, default 10),
  accreditation status.
- **Accreditation status**: `prospect → verified → accredited`, plus `suspended`.
  Sales creates prospects and moves them to `verified` after checking documents.
  Only Admin or Finance sets `accredited` or `suspended`. Sales orders (Phase 3)
  are accepted only for `accredited` clients; this is enforced in the database.
- **Client site**: code, name, address, island group (Luzon, Visayas, Mindanao),
  delivery zone (Phase 3), optional map pin.
- **Contact**: name, position, mobile, email, preferred channel, linked to a client
  and optionally a site.

### 7.2 Tickets

- Fields: code, client, site (optional), channel (Messenger, Viber, WhatsApp, email,
  call, visit), category, subject, description, owner, status, due date, created by.
- Statuses: `open → in_progress → waiting_on_client → resolved → closed`. Reopening
  is allowed and audited. A ticket is voided, never deleted.
- Categories (list editable by Admin): delivery request, dehire/pull-out request,
  swap request, billing concern, damaged pallets/repair, pallet audit,
  inquiry/quotation, complaint, other.
- Comment thread: every comment has author and time and cannot be edited after
  posting. Status and owner changes appear in the thread automatically.
- Attachments: images and PDFs (chat screenshots), up to 10 MB each, on the ticket
  or on a comment.
- **Backlog and aging dashboard**: open tickets by owner, by client, by category;
  age buckets 0–2, 3–7, 8–14 and 15+ days; overdue (past due date) and unassigned
  counts. Sales sees the same dashboard limited to own accounts.
- **Search** across code, subject, description, comments, client and site name
  (Postgres full-text), limited by what the user may see.

### 7.3 Intake interface (for future webhooks)

```ts
interface InboundMessage {
  source: 'manual' | 'messenger' | 'whatsapp';
  externalThreadId?: string;   // conversation id on the channel
  externalMessageId?: string;  // unique per message, prevents duplicates
  senderName?: string; senderHandle?: string;
  text: string; attachments: IntakeFile[]; receivedAt: Date;
}
interface TicketIntake { ingest(msg: InboundMessage): Promise<{ ticketId: string }>; }
```

Tickets carry `source` and `external_thread_id`; comments carry
`external_message_id` (unique). Phase 1 ships only the `manual` adapter, used by the
New Ticket form. A later Messenger or WhatsApp webhook becomes another adapter
calling the same `ingest`, with no table changes.

### 7.4 Clock in / clock out and client visit selfie (added)

Purpose: a dated, located record of field work by sales and deployment staff.

- **Clock in / clock out.** One big button on the phone home screen. Each press
  records time, GPS position and GPS accuracy. One open shift per user at a time; a
  shift left open is closed by Admin with a reason.
- **Client visit.** Pick the client (or quick-add a prospect) and site, take a selfie
  with the phone camera, add purpose and notes. The app stamps date, time and GPS on
  the photo and stores the same values as data. A visit can be linked to a ticket
  or create one.
- Both work offline through the queue in §4.2.
- **Views.** Own history for the user. Admin sees all: daily attendance list, visits
  by person and by client, map link per record, CSV export.
- **Not connected to pay.** Phase 4 pay is piece-rate and per-trip only.
- **Limit to be aware of.** A web app records what the phone reports. It cannot fully
  prevent a faked location. Photos must be taken in-app at the moment of the visit;
  choosing an old photo from the gallery is not offered.

### 7.5 Phase 1 tables

`profiles`, `role_permissions`, `audit_log`, `doc_sequences`, `code_sequences`,
`clients`, `client_sites`, `contacts`, `ticket_categories`, `tickets`,
`ticket_comments`, `ticket_attachments`, `attendance_logs`, `client_visits`.

## 8. Phases 2–6 (design outline; detailed in each phase plan)

### 8.1 Phase 2 — Proposals, contracts, renewals

- **Proposal** (`PRP-`): client; one or more lines of site + pallet size + pallet type
  + quantity + daily rate; lock-in term; delivery terms (free, or per-trip fee by
  zone); validity date. Status: `draft → sent → signed_conforme`, or `superseded`
  when a newer proposal replaces it.
- One master template with clause variants chosen by options (delivery free/charged,
  lock-in length, payment terms). Output: branded PDF. A sent proposal is frozen;
  changes mean a new proposal that supersedes it.
- **Contract** (`CTR-`): generated from the signed proposal, carrying its lines and
  rates; start and end dates; signed copy upload.
- **Renewals**: dashboard of contracts ending within 90, 60 and 30 days, with an
  in-app alert to the account owner and Admin at each mark. Renewing creates a new
  proposal pre-filled from the contract.

### 8.2 Phase 3 — Sales order and delivery schedule

- **Sales order** (`SO-`): types `deployment`, `dehire`, `pallet_audit`,
  `mobile_onsite_repair`. Requires an accredited client and a signed-conforme
  proposal or an active contract. Every line has site, **pallet size**, pallet type
  and quantity; rate comes from the proposal/contract line.
- Minimum deployment order: one truckload (default 240, a setting). A smaller
  deployment line needs an override reason from the Deployment Officer.
- **Delivery schedule**: calendar/list shared by sales (read), production (read) and
  ops (edit). Rescheduling needs a reason code (production delay, truck
  availability, client request, other) and keeps history.

### 8.3 Phase 3 — Trips and documents

- One trip = one truck, one driver, helpers, one destination site, one **trip ticket**
  (`TT-`), one **DR** (`DR-`), one **gate pass** (`GP-`), one **petty cash voucher**
  (`PCV-`), all created together in one transaction.
- A partial load is accepted only when it is the last trip of an order whose total
  exceeds one truckload.
- **Client pick-up**: the client's own truck collects. DR and gate pass only (no trip
  ticket or voucher); the client's plate number and driver name are recorded.
- **Voucher**: `draft → approved (Admin) → released (Finance) → liquidated`, or
  voided. A truck cannot be checked out at the gate until the voucher is released.
- **Gate**: the guard checks the truck out against the gate pass (size, quantity,
  truck, driver) and back in on return.
- **Delivery fee**: one fee per trip from the zone matrix (zone → amount), charged or
  waived according to the proposal.
- **Proof of delivery** on the driver's phone: time-in, time-out, 1–2 photos of loaded
  pallets, 1–2 of unloaded pallets (each with GPS and timestamp), receiver name and
  on-screen signature. Works offline.

### 8.4 Phase 3 — Rental clock

- Starts on the date the DR is signed and received at the client site (from the
  proof of delivery, confirmed by the Deployment Officer).
- Stops on the date RPPC receives the pallets back (dehire trip checked in at the
  gate, or client drop-off received by the warehouse).
- Each signed DR line creates a **rental batch**: site, size, type, quantity, daily
  rate, start date.

### 8.5 Phase 3 — Returns and billing

- A return of N pallets (any number, or a 240 truckload) closes N pallets from the
  **oldest open batches** of that size and type at that site, with the return date as
  their end date. Those N pallets are billed through the return date and not after.
  The remainder keeps billing. With one rate per site and size this gives exactly
  "balance × rate × days"; oldest-first only matters if a site has two rates.
- **Billing summary** (`BS-`) per client site per period: one row per batch segment
  (quantity, rate, from, to, days, amount), plus delivery fees for trips in the
  period, then subtotal, 12% VAT, total.
- Period: D2. The cutoff day can be changed anytime; the change applies from the next
  period not yet drafted.
- Workflow: `draft → sent_to_client → client_approved → exported`. An exported
  summary is frozen. Corrections go into the next period as an adjustment line with
  a reason.

`batchRent` is implemented exactly as given in the brief and unit-tested, including:
same-day deliver and return (1 day), batch starting before the period, batch ending
after the period, batch entirely outside the period (0), month lengths, and a
cutoff-day change.

### 8.6 Phase 3 — Items found in the current transaction log

The 2026 log shows practices the brief does not describe. Proposed handling, to be
confirmed (see §10):

- **Swapping** (damaged pallets exchanged one-for-one on the same day). Proposed: a
  swap is recorded as a stock exchange and does **not** touch the rental clock, so
  the client is not billed twice for the swap day.
- **BER / Lost** pallets. Proposed: the Deployment Officer records a BER/Lost entry
  that removes the pallets from the site balance and ends their rent on that date.
  Charging for lost pallets is not computed.
- **Pallet types** in use: BNEP Brand New, BGP Brown Good, RGP Red Good, GUP Good
  Used, Plastic, R45, New Design, Shipping Pallet. Proposed: pallet type is a second
  explicit field next to size on every order, DR and stock line.

### 8.7 Phase 3 — Opening balances

Source: "2026 Transaction Logs", sheet *Monthly Summary* (about 240 customer-site
rows with a running balance of Delivery, Dehire and BER/Lost).

- At go-live, one opening rental batch is created per site, size and type, with the
  balance as of the go-live date and the go-live date as its start date. Periods
  before go-live stay in Excel.
- The sheet has balances but no pallet size, no daily rate and no client/site split.
  The import template therefore needs, per row: client, site, size, type, quantity,
  daily rate. I will pre-fill it from the sheet for RPPC to complete and check.
- The import is a reviewed, one-time, audited action by Admin.

### 8.8 Phase 4 — Production capture and pay

- **Daily output**: a maker logs pallets built per day by size; a painter logs pallets
  dipped, painted and branded by size. Where a worker has no phone, the guard or
  Production Officer enters the count for them and the record shows who entered it.
- **Checks**: guard verification is recorded per entry; the Production Officer/QC
  approves each day's counts. Only approved counts are paid and (Phase 5) added to
  stock. An approved count is corrected by a reversing entry, not edited.
- **Piece rates**: table of task × size → rate, with effective dates.
- **Weekly run** (`PAY-`): Saturday to Friday, payday Saturday. Pay = approved
  quantity × rate in force on the output date. Drivers and helpers get a flat amount
  per completed trip ticket in the same run.
- **Approval chain**: Production Officer → HR → Finance → Admin. Each step is a named,
  timed sign-off; a rejection returns the run to draft with a reason. After final
  approval the run is frozen and Finance marks it released.
- Outputs: payroll sheet (XLSX/PDF) and a per-worker payslip view. A worker sees only
  their own.

### 8.9 Phase 5 — Inventory

- **Pallet stock** by size, type/condition and location (warehouse, in transit, at a
  client site). Kept as a ledger of movements; balances are computed from it.
- Movements are created automatically: production approval (+warehouse), gate
  check-out (warehouse → in transit), signed DR (in transit → client site), return
  received (client site → warehouse), swap, BER/Lost.
- **Materials** (lumber, nails, paint, chemicals): items with unit of measure,
  receipts and issues to production.
- **Stock counts** and adjustments with a required reason, approved by Admin.

### 8.10 Phase 6 — Purchasing

- Suppliers; **purchase request** (`PR-`) → Admin approval → **purchase order**
  (`PO-`) → receiving against the PO, partial receipts allowed, which adds to
  inventory → CSV/XLSX export for SAP.

### 8.11 SAP exports

Finance downloads CSV/XLSX files for approved billing summaries, released vouchers,
released payroll runs and received POs. The column layout is agreed with Finance in
the phase that builds each export. No data flows back from SAP.

## 9. Testing

- **Unit tests first** for money and rules: rent, billing period, piece-rate pay,
  trip pay, FIFO return allocation.
- **Document numbering**: sequential, per series and year, safe under concurrent
  inserts, not reused after a void, year rollover.
- **RLS tests**: for every table, sign in as each of the 12 roles and assert what
  can be read, inserted, updated and deleted. Includes the pay-privacy rules and
  "own accounts" rules with two different sales users.
- **Audit tests**: every business table writes an audit row; `audit_log` cannot be
  changed.
- **End-to-end smoke tests** for the demo checklist flows.
- Each phase ends with a demo checklist to click through per role.

## 10. Open items

These do not block Phase 1. Each has a proposed default that will be used unless
changed.

| # | Question | Proposed default | Needed by |
|---|---|---|---|
| O1 | Swapping: confirm a same-day swap must not change billing. | No billing effect | Phase 3 |
| O2 | BER/Lost: confirm it only stops rent, with no lost-pallet charge computed. | Stops rent only | Phase 3 |
| O3 | Pallet type (BNEP, BGP, RGP, GUP, …) as a required field beside size. Does the rate differ by type? | Required field; rate per size + type | Phase 2 |
| O4 | In the log, is the prefix (FSC, FCL, …) the billed principal and the rest the site? | I propose a client/site mapping for RPPC to review | Phase 3 |
| O5 | What is the "POTS" number on each log row? Should the system keep it? | Kept as a free-text reference on returns | Phase 3 |
| O6 | Loads of 250 and 253 appear in the log. Is 240 the fixed truckload? | Truck capacity is a per-truck setting, default 240 | Phase 3 |
| O7 | Proposal and contract wording (current best versions). | Placeholder clauses until supplied | Phase 2 |
| O8 | Who clocks in and out and logs visits: Sales only, or Deployment Officers too? | Sales and Deployment Officer | Phase 1 |
| O9 | SAP import column layouts. | Agreed with Finance per export | Phases 3, 4, 6 |
