-- The mock's internal schema.
--
-- Designed to map cleanly onto Lumanu's wire format, not to mirror it. Where a
-- name differs from the wire it is because the internal model is the sane one
-- and the provider does the translation: a Payable stores `partner_id`, and the
-- provider resolves that into the `vendor_email` / `vendor_display_name` pair
-- Lumanu returns.
--
-- Money is `bigint` cents throughout, matching Lumanu exactly (see
-- docs/02, "Monetary amounts"), so the provider performs no conversion.
-- `integer` would hold the canonical figures fine but tops out around $21M,
-- which is a silly ceiling to build in.
--
-- Status values are CHECK-constrained to exactly the enums harvested into
-- docs/lumanu-reference/openapi.json. A test asserts the two still agree.

create table workspaces (
  id                       uuid primary key,
  display_name             text        not null,
  profile_image_url        text,
  -- Lumanu's Account carries two figures: what is held, and what may be
  -- committed. Funding Capacity is measured against available_balance.
  -- See docs/discoveries/2026-08-12-workspace-balance-is-two-figures.md
  balance_cents            bigint      not null default 0,
  available_balance_cents  bigint      not null default 0,
  funding_fee_percent      numeric,
  additive_funding_fee     boolean,
  vendor_invite_url        text,
  created_at               timestamptz not null,
  updated_at               timestamptz not null,

  constraint workspaces_available_within_balance
    check (available_balance_cents <= balance_cents),
  constraint workspaces_balance_not_negative
    check (balance_cents >= 0 and available_balance_cents >= 0)
);

create table projects (
  id                  uuid primary key,
  workspace_id        uuid        not null references workspaces (id) on delete cascade,
  name                text        not null,
  alias               text,
  description         text,
  po_number           text,
  budget_amount_cents bigint,
  budget_denomination text,
  archived            boolean     not null default false,
  created_at          timestamptz not null,
  updated_at          timestamptz not null
);

-- No separate vendors table. With one Workspace a Partner/Vendor split would
-- add a join that earns nothing; the point at which it becomes worthwhile is a
-- second Workspace sharing a Partner across both.
create table partners (
  id                  uuid primary key,
  workspace_id        uuid        not null references workspaces (id) on delete cascade,
  name                text        not null,
  lumanu_id           text,
  email               text        not null,
  -- One value covering onboarding and tax state together, not two fields.
  -- Nullable because Lumanu's is: a Partner invited but not yet through any
  -- check has no status at all.
  status              text,
  tax_origin_country  text,
  tags                text[]      not null default '{}',
  notes               text,
  has_approval_grant  boolean     not null default false,
  legal_business_name text,
  legal_business_type text,
  description         text,
  has_wallet          boolean     not null default false,
  created_at          timestamptz not null,
  updated_at          timestamptz not null,

  constraint partners_status_is_lumanus check (status is null or status in (
    'missing_metadata_file_us_taxes',
    'in_process',
    'awaiting_w9_submission',
    'w8_submitted',
    'awaiting_w8_submission',
    'completed_w9'
  )),
  constraint partners_email_unique_per_workspace unique (workspace_id, email)
);

create table payables (
  id              uuid primary key,
  workspace_id    uuid        not null references workspaces (id) on delete cascade,
  project_id      uuid        references projects (id) on delete set null,
  partner_id      uuid        not null references partners (id) on delete restrict,
  amount_cents    bigint      not null,
  description     text        not null,
  due_date        timestamptz,
  invoice_number  integer,
  -- Payor approval intent. `paid` is Lumanu's and is never produced here:
  -- will_pay is this POC's terminal state, and settlement is evidenced by a
  -- Funding and its Balance Transaction.
  status          text        not null,
  -- Lumanu's fuller lifecycle status, carried for fidelity. Nothing reasons
  -- over it.
  payable_status  text,
  vendor_status   text,
  created_at      timestamptz not null,
  updated_at      timestamptz not null,

  constraint payables_amount_positive check (amount_cents > 0),
  constraint payables_status_is_lumanus check (status in (
    'unapproved', 'approved', 'will_pay', 'canceled', 'paid'
  )),
  constraint payables_lifecycle_status_is_lumanus check (payable_status is null or payable_status in (
    'not_approved', 'approved', 'scheduled', 'awaiting_payment',
    'awaiting_payee', 'paid', 'canceled', 'reversed'
  ))
);

create index payables_workspace_status_idx on payables (workspace_id, status);
create index payables_partner_idx on payables (partner_id);

create table fundings (
  id                 uuid primary key,
  workspace_id       uuid        not null references workspaces (id) on delete cascade,
  -- This POC models `balance` only: drawing on the pre-funded Workspace
  -- Balance to pay approved Payables. `invoice` is out of scope.
  method             text        not null,
  status             text        not null,
  amount_cents       bigint      not null,
  base_amount_cents  bigint,
  fee_amount_cents   bigint,
  fee_percent        numeric,
  is_fee_additive    boolean,
  created_at         timestamptz not null,
  updated_at         timestamptz not null,

  constraint fundings_method_is_lumanus check (method in ('balance', 'invoice')),
  constraint fundings_amount_positive check (amount_cents > 0)
);

-- A Funding pays a set of Payables. The unique constraint on payable_id is the
-- schema-level half of "a Payable is never funded twice"; the transactional
-- half lives in the funding function.
create table funding_payables (
  funding_id uuid not null references fundings (id) on delete cascade,
  payable_id uuid not null references payables (id) on delete restrict,

  primary key (funding_id, payable_id),
  constraint funding_payables_payable_funded_once unique (payable_id)
);

create table balance_transactions (
  id                   uuid primary key,
  workspace_id         uuid        not null references workspaces (id) on delete cascade,
  funding_id           uuid        references fundings (id) on delete set null,
  description          text        not null,
  amount_cents         bigint      not null,
  balance_change_cents bigint      not null,
  ending_balance_cents bigint      not null,
  status               text        not null,
  type                 text        not null,
  created_at           timestamptz not null,

  constraint balance_transactions_status_is_lumanus check (status in ('pending', 'processed')),
  constraint balance_transactions_type_is_lumanus check (type in (
    'deposit', 'fee', 'payment', 'withdrawal', 'invoice'
  ))
);

create index balance_transactions_workspace_created_idx
  on balance_transactions (workspace_id, created_at);

-- Named after Lumanu's real webhook events, so a future real integration has an
-- obvious place to land inbound events. No webhook delivery is built.
create table audit_events (
  id           uuid primary key,
  workspace_id uuid        not null references workspaces (id) on delete cascade,
  event_type   text        not null,
  subject_id   uuid,
  payload      jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null
);

create index audit_events_workspace_created_idx on audit_events (workspace_id, created_at);
