-- The writes, as PostgreSQL functions.
--
-- **Why not Hasura mutations.** A Hasura mutation runs all of its fields in one
-- transaction, which sounds like enough — but it has no way to abort. A guard
-- expressed as a `where` clause that matches nothing updates zero rows and
-- reports success, so a mutation that debits the Workspace Balance and then
-- fails to move the Payables commits the debit anyway. Every guard here has to
-- be able to stop the whole operation, and only a function can do that.
--
-- **Why an outcome row rather than `raise`.** Raising would also be atomic, but
-- the reason would then have to be parsed back out of a GraphQL error string to
-- tell "insufficient balance" from "not approved" — and the caller has to tell
-- them apart to respond correctly. Each function returns a row naming what
-- happened, which the provider maps to a typed error.
--
-- The outcome vocabulary is the same set the in-memory implementation raises,
-- so the contract suite can hold both to the same behaviour:
--
--   ok | not_found | invalid_input | invalid_state | insufficient_balance

-- Exists only to give the functions below a shape Hasura can track: Hasura
-- refuses to track a function that does not return a table, and a composite
-- type is not a table. **No row is ever inserted here.** It is a return type
-- wearing a table's clothes.
create table write_outcomes (
  outcome    text not null,
  detail     text,
  subject    text,
  state      text,
  required   bigint,
  available  bigint,
  funding_id uuid,
  payable_id uuid
);

comment on table write_outcomes is
  'Return shape for the write functions. Never populated; see db/migrations/0002.';

-- Approving is a Buyer's decision that work is owed. Only an unapproved Payable
-- can be approved: re-approving something funded would be meaningless, and
-- approving something cancelled would resurrect it.
create or replace function approve_payable(p_payable_id uuid)
returns setof write_outcomes
language plpgsql
volatile
as $$
declare
  v_payable payables%rowtype;
begin
  select * into v_payable from payables where id = p_payable_id;

  if not found then
    return query select 'not_found'::text, 'No Payable with that id.'::text, 'Payable'::text,
                        null::text, null::bigint, null::bigint, null::uuid, p_payable_id;
    return;
  end if;

  if v_payable.status <> 'unapproved' then
    return query select 'invalid_state'::text,
                        'Only an unapproved Payable can be approved.'::text, 'Payable'::text,
                        v_payable.status, null::bigint, null::bigint, null::uuid, p_payable_id;
    return;
  end if;

  update payables
     set status = 'approved', payable_status = 'approved', updated_at = now()
   where id = p_payable_id;

  insert into audit_events (id, workspace_id, event_type, subject_id, created_at)
  values (gen_random_uuid(), v_payable.workspace_id, 'payable.approved', p_payable_id, now());

  return query select 'ok'::text, null::text, 'Payable'::text, 'approved'::text,
                      null::bigint, null::bigint, null::uuid, p_payable_id;
end;
$$;

-- Cancelling withdraws an obligation raised in error. A funded Payable is
-- excluded: the money has already left the Workspace Balance, and cancelling
-- would unwind a commitment with no corresponding credit.
create or replace function cancel_payable(p_payable_id uuid)
returns setof write_outcomes
language plpgsql
volatile
as $$
declare
  v_payable payables%rowtype;
begin
  select * into v_payable from payables where id = p_payable_id;

  if not found then
    return query select 'not_found'::text, 'No Payable with that id.'::text, 'Payable'::text,
                        null::text, null::bigint, null::bigint, null::uuid, p_payable_id;
    return;
  end if;

  if v_payable.status not in ('unapproved', 'approved') then
    return query select 'invalid_state'::text,
                        'Only a Payable that has not been funded can be cancelled.'::text,
                        'Payable'::text, v_payable.status,
                        null::bigint, null::bigint, null::uuid, p_payable_id;
    return;
  end if;

  update payables
     set status = 'canceled', payable_status = 'canceled', updated_at = now()
   where id = p_payable_id;

  insert into audit_events (id, workspace_id, event_type, subject_id, created_at)
  values (gen_random_uuid(), v_payable.workspace_id, 'payable.canceled', p_payable_id, now());

  return query select 'ok'::text, null::text, 'Payable'::text, 'canceled'::text,
                      null::bigint, null::bigint, null::uuid, p_payable_id;
end;
$$;

-- Funding: the whole reason these are functions.
--
-- Checks every Payable's status, checks every Partner's status, totals the
-- amounts, verifies and debits the balance, records the Funding and its Balance
-- Transaction, and moves the Payables to will_pay — inside one transaction,
-- with every check completed before the first write.
--
-- Idempotency is by state, not by key. A Payable already linked to a Funding is
-- skipped rather than rejected, so a retried request finds nothing left to fund
-- and debits nothing. `funding_payables.payable_id` is unique, so even a
-- concurrent retry cannot pay one twice.
create or replace function fund_payables(p_workspace_id uuid, p_payable_ids uuid[])
returns setof write_outcomes
language plpgsql
volatile
as $$
declare
  v_workspace  workspaces%rowtype;
  v_payable    payables%rowtype;
  v_partner    partners%rowtype;
  v_id         uuid;
  v_to_fund    uuid[] := '{}';
  v_total      bigint := 0;
  v_funding_id uuid;
  v_existing   uuid;
  v_names      text;
  v_remaining  bigint;
begin
  if p_payable_ids is null or array_length(p_payable_ids, 1) is null then
    return query select 'invalid_input'::text,
                        'payable_ids is required when method is "balance".'::text,
                        'Funding'::text, null::text, null::bigint, null::bigint,
                        null::uuid, null::uuid;
    return;
  end if;

  -- Deduplicated before anything else. The loop below decides what to fund by
  -- looking for an existing funding_payables row, and within this transaction
  -- there is none yet — so the same id twice would be counted twice, doubling
  -- the total, and then violate funding_payables_payable_funded_once on insert.
  -- The unique constraint would catch the double-pay, but as an unhandled
  -- exception rather than as an outcome row.
  select array_agg(distinct id) into p_payable_ids from unnest(p_payable_ids) as id;

  -- `for update` holds the balance row for the rest of the transaction, so two
  -- concurrent Fundings cannot both read the same available balance and both
  -- conclude that they fit.
  select * into v_workspace from workspaces where id = p_workspace_id for update;

  if not found then
    return query select 'not_found'::text, 'No Workspace with that id.'::text, 'Workspace'::text,
                        null::text, null::bigint, null::bigint, null::uuid, null::uuid;
    return;
  end if;

  foreach v_id in array p_payable_ids loop
    select * into v_payable from payables where id = v_id;

    if not found then
      return query select 'not_found'::text, 'No Payable with that id.'::text, 'Payable'::text,
                          null::text, null::bigint, null::bigint, null::uuid, v_id;
      return;
    end if;

    if v_payable.workspace_id <> p_workspace_id then
      return query select 'invalid_input'::text,
                          'Payable belongs to a different Workspace.'::text, 'Payable'::text,
                          null::text, null::bigint, null::bigint, null::uuid, v_id;
      return;
    end if;

    -- Already funded: a no-op, not a failure.
    v_existing := null;
    select funding_id into v_existing from funding_payables where payable_id = v_id;

    if v_existing is null then
      if v_payable.status <> 'approved' then
        return query select 'invalid_state'::text,
                            'Only an approved Payable can be funded.'::text, 'Payable'::text,
                            v_payable.status, null::bigint, null::bigint, null::uuid, v_id;
        return;
      end if;

      select * into v_partner from partners where id = v_payable.partner_id;

      if v_partner.status is distinct from 'completed_w9' then
        return query select 'invalid_state'::text,
                            'A Partner must be completed_w9 before their Payables can be funded.'::text,
                            'Partner'::text, coalesce(v_partner.status, 'unknown'),
                            null::bigint, null::bigint, null::uuid, v_id;
        return;
      end if;

      v_to_fund := array_append(v_to_fund, v_id);
      v_total := v_total + v_payable.amount_cents;
    end if;
  end loop;

  if v_total > v_workspace.available_balance_cents then
    return query select 'insufficient_balance'::text,
                        'The Workspace Balance does not cover this Funding.'::text,
                        'Workspace'::text, null::text, v_total,
                        v_workspace.available_balance_cents, null::uuid, null::uuid;
    return;
  end if;

  -- Everything in the request was already funded. Return the Funding that paid
  -- them rather than creating an empty one.
  if array_length(v_to_fund, 1) is null then
    select fp.funding_id into v_funding_id
      from funding_payables fp
     where fp.payable_id = p_payable_ids[1];

    return query select 'ok'::text, 'Every Payable in this request was already funded.'::text,
                        'Funding'::text, 'completed'::text, 0::bigint,
                        v_workspace.available_balance_cents, v_funding_id, null::uuid;
    return;
  end if;

  v_funding_id := gen_random_uuid();
  v_remaining := v_workspace.balance_cents - v_total;

  -- Fees are fixed at zero for this POC, so the debit equals the total.
  insert into fundings (id, workspace_id, method, status, amount_cents,
                        fee_amount_cents, fee_percent, created_at, updated_at)
  values (v_funding_id, p_workspace_id, 'balance', 'completed', v_total, 0, 0, now(), now());

  insert into funding_payables (funding_id, payable_id)
  select v_funding_id, unnest(v_to_fund);

  update payables
     set status = 'will_pay', payable_status = 'scheduled', updated_at = now()
   where id = any(v_to_fund);

  update workspaces
     set balance_cents = v_remaining,
         available_balance_cents = available_balance_cents - v_total,
         updated_at = now()
   where id = p_workspace_id;

  select string_agg(distinct pr.name, ', ') into v_names
    from payables p
    join partners pr on pr.id = p.partner_id
   where p.id = any(v_to_fund);

  insert into balance_transactions (id, workspace_id, funding_id, description, amount_cents,
                                    balance_change_cents, ending_balance_cents, status, type,
                                    created_at)
  values (gen_random_uuid(), p_workspace_id, v_funding_id,
          'Funding — ' || coalesce(v_names, 'Partners'),
          v_total, -v_total, v_remaining, 'processed', 'payment', now());

  insert into audit_events (id, workspace_id, event_type, subject_id, created_at)
  values (gen_random_uuid(), p_workspace_id, 'funding.created', v_funding_id, now());

  return query select 'ok'::text, null::text, 'Funding'::text, 'completed'::text, v_total,
                      v_workspace.available_balance_cents - v_total, v_funding_id, null::uuid;
end;
$$;
