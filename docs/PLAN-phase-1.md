# Phase 1 Plan — CRM, client concerns, field attendance

Status: **draft for approval** · 2026-11-12 · Spec: `docs/SPEC.md` §4–§7

## Goal

A working, installable app where staff log in by role, manage clients, sites and
contacts, record and chase every client concern as a ticket, and field staff clock
in/out and log client visits with a selfie, timestamp and GPS.

## What you will be able to do at the end

- Admin creates user accounts and edits the permission matrix.
- Sales creates prospects, sites and contacts; Admin or Finance accredits a client.
- Anyone with ticket access logs a concern in under a minute, attaches the chat
  screenshot, assigns an owner and a due date.
- The backlog dashboard shows what is open, how old, whose it is and what is overdue.
- A salesperson clocks in on the phone, logs a client visit with a stamped selfie,
  and clocks out, even with no signal.
- Admin sees who changed what in the audit log.

## Not in Phase 1

Proposals, contracts, sales orders, deliveries, billing, production, payroll,
inventory, purchasing, live Messenger/WhatsApp integration, cloud deployment.

## Working method

- Schema changes only through `supabase/migrations/`.
- Tests are written before the code they cover for: document numbering, RLS per role
  per table, audit log, permission rules.
- One commit per task, pushed to `jrfibanez/RPPC1`.
- Detailed step-by-step task breakdown is written after this plan is approved.

## Tasks

### 0. Project setup
- Next.js (App Router, TypeScript), ESLint, Vitest, Playwright.
- Local Supabase stack; `.env.example`; npm scripts for `db:reset`, `test`,
  `test:rls`, `test:e2e`.
- **Risk:** this cloud session has Docker installed but its service is not running.
  First step is to start it. If it cannot run here, the fallback is a separate,
  free-tier Supabase development project, which I will ask you to approve before
  creating.
- Done when: the app starts, an empty test run passes, the database resets from
  migrations.

### 1. Security foundation
- Migrations: `app_role` enum, `profiles`, `role_permissions` + `has_perm()`,
  `audit_log` + generic audit trigger, `doc_sequences` + `next_doc_code()`,
  `code_sequences` for master data codes.
- Tests first: numbering (sequence, per year, concurrent inserts, no reuse after
  void); audit rows written; `audit_log` cannot be updated or deleted by any role;
  default-deny for the anonymous key.
- Done when: all of the above tests pass.

### 2. Login and user management
- Email + password login, logout, session handling, inactive users blocked.
- Admin screens: create user (real email or generated `w-0001@rppc.local` style
  login), set role, deactivate, reset password. No self-signup route exists.
- Admin screen: permission matrix editor, with the two guards from SPEC §5.2.
- Role-based navigation: office layout and phone layout.
- Tests: only Admin can create or change users; a deactivated user cannot sign in.

### 3. Clients, sites, contacts
- Migrations and RLS for `clients`, `client_sites`, `contacts`; codes `CL-0001`,
  `CL-0001-S01`.
- Screens: client list with search and filters, client page (details, sites,
  contacts, tickets, visits), create/edit forms with Zod validation.
- Accreditation: Sales moves `prospect → verified`; only Admin/Finance sets
  `accredited` or `suspended`, enforced in the database.
- Tests: RLS for all 12 roles on the three tables; a sales user cannot edit another
  sales user's client; Sales cannot accredit.

### 4. Tickets
- Migrations and RLS for `ticket_categories`, `tickets`, `ticket_comments`,
  `ticket_attachments`; private `ticket-attachments` bucket with matching policies.
- Intake interface (`lib/intake`) with the `manual` adapter; New Ticket form uses it.
- Screens: ticket list with filters and full-text search, ticket page (thread,
  attachments, status/owner/due date changes shown in the thread), void with reason.
- Tests: RLS for all 12 roles on the four tables; visibility rule D7 with two sales
  users; comments cannot be edited; attachments unreachable without access;
  duplicate `external_message_id` creates no second comment.

### 5. Backlog and aging dashboard
- Counts by owner, client, category; age buckets 0–2, 3–7, 8–14, 15+ days; overdue
  and unassigned. Each number opens the filtered ticket list.
- Sales sees own accounts only (same RLS, no separate logic).
- Tests: unit tests for aging buckets and overdue logic in Asia/Manila time.

### 6. Installable app and offline queue
- Manifest, icons from the RPPC logo, service worker, cached app shell.
- `lib/offline`: IndexedDB queue, idempotent sync by client UUID, "Waiting to send"
  and "Needs attention" states, photo compression and stamping.
- Tests: queue unit tests (order, retry, duplicate send creates one record,
  rejection keeps the item).

### 7. Clock in/out and client visits
- Migrations and RLS for `attendance_logs`, `client_visits`; private `visit-photos`
  bucket.
- Phone screens: clock in / clock out button with GPS; New Visit (client, site,
  in-app selfie, purpose, notes, optional link to ticket). Both go through the
  offline queue.
- Office screens for Admin: daily attendance, visits by person and client, map
  link, CSV export; close an open shift with a reason.
- Tests: RLS for all 12 roles; a user sees only own records, Admin sees all; one
  open shift per user; visit photo unreachable without access.

### 8. Seed data, checks and demo
- Seed: one user per role (two for sales), about 12 fake clients with sites and
  contacts, about 40 tickets across statuses and ages, sample attendance and visits.
- End-to-end smoke tests for the demo flows; full test run; lint; type check.
- Deliver the **Phase 1 demo checklist** (click-through per role), then stop for
  acceptance.

## Acceptance for Phase 1

1. All unit, RLS, audit and end-to-end tests pass.
2. You complete the demo checklist as each role without finding a permission leak.
3. No feature outside this plan has been added.

## Decisions needed from you now

- Approve `docs/SPEC.md` and this plan, or list changes.
- SPEC open item **O8**: should Deployment Officers also clock in/out and log
  visits, or Sales only? Default is both.
