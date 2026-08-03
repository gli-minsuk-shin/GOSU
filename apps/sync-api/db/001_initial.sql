-- Hosted collaboration metadata only. Source files, raw logs, metrics, datasets,
-- checkpoints, and artifacts must never be added to this schema.
create extension if not exists pgcrypto;

create table if not exists labs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists identities (
  id uuid primary key default gen_random_uuid(),
  issuer text not null,
  subject text not null,
  display_name text,
  created_at timestamptz not null default now(),
  unique (issuer, subject)
);

create table if not exists memberships (
  lab_id uuid not null references labs(id),
  identity_id uuid not null references identities(id),
  role text not null check (role in ('owner','project_lead','researcher','reviewer','viewer')),
  primary key (lab_id, identity_id)
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references labs(id),
  name text not null,
  slug text not null,
  repository text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  unique (lab_id, slug)
);

create table if not exists work_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  title text not null,
  status text not null,
  assignee_id uuid references identities(id),
  resource_type text,
  resource_id text,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists visible_chat_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  actor_id uuid references identities(id),
  role text not null check (role in ('user','assistant')),
  content text not null,
  model_id text,
  created_at timestamptz not null default now()
);

create table if not exists run_summaries (
  project_id uuid not null references projects(id),
  trial_id text not null,
  state text,
  summary_metrics jsonb not null default '{}',
  last_sequence bigint not null default -1,
  updated_at timestamptz not null,
  primary key (project_id, trial_id)
);

create table if not exists approval_records (
  id uuid primary key,
  lab_id uuid not null references labs(id),
  project_id uuid not null references projects(id),
  actor_id uuid not null references identities(id),
  subject_type text not null check (subject_type in ('objective','campaign','manuscript_revision','overleaf_export','work_item')),
  subject_id text not null,
  subject_version bigint not null check (subject_version > 0),
  decision text not null check (decision in ('approved','rejected','changes_requested')),
  rationale text,
  version bigint not null check (version > 0),
  created_at timestamptz not null default now(),
  unique (lab_id, project_id, subject_type, subject_id, version)
);

create table if not exists audit_events (
  id uuid primary key,
  lab_id uuid not null references labs(id),
  project_id uuid not null references projects(id),
  actor_id uuid not null references identities(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  entity_version bigint not null check (entity_version > 0),
  details jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);

create table if not exists sync_outbox (
  id uuid primary key,
  lab_id uuid not null references labs(id),
  project_id uuid references projects(id),
  actor_id uuid references identities(id),
  event_type text not null,
  schema_version integer not null,
  entity_version bigint not null,
  payload jsonb not null,
  occurred_at timestamptz not null,
  published_at timestamptz
);

create table if not exists idempotency_keys (
  lab_id uuid not null references labs(id),
  project_id uuid not null references projects(id),
  actor_id uuid not null references identities(id),
  scope text not null,
  key uuid not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (lab_id, project_id, scope, key)
);

alter table labs enable row level security;
alter table projects enable row level security;
alter table work_items enable row level security;
alter table visible_chat_messages enable row level security;
alter table run_summaries enable row level security;
alter table memberships enable row level security;
alter table approval_records enable row level security;
alter table audit_events enable row level security;
alter table sync_outbox enable row level security;
alter table idempotency_keys enable row level security;

alter table labs force row level security;
alter table projects force row level security;
alter table work_items force row level security;
alter table visible_chat_messages force row level security;
alter table run_summaries force row level security;
alter table memberships force row level security;
alter table approval_records force row level security;
alter table audit_events force row level security;
alter table sync_outbox force row level security;
alter table idempotency_keys force row level security;

create index if not exists work_items_project_updated_idx on work_items (project_id, updated_at desc);
create index if not exists visible_chat_project_created_idx on visible_chat_messages (project_id, created_at);
create index if not exists approval_project_created_idx on approval_records (project_id, created_at desc);
create index if not exists audit_project_occurred_idx on audit_events (project_id, occurred_at desc);
create index if not exists outbox_unpublished_idx on sync_outbox (occurred_at) where published_at is null;
create index if not exists idempotency_project_created_idx on idempotency_keys (project_id, created_at desc);

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = current_schema() and tablename = 'labs' and policyname = 'labs_tenant') then
    create policy labs_tenant on labs using (id::text = current_setting('gosu.lab_id', true));
  end if;
  if not exists (select 1 from pg_policies where schemaname = current_schema() and tablename = 'memberships' and policyname = 'memberships_tenant') then
    create policy memberships_tenant on memberships using (lab_id::text = current_setting('gosu.lab_id', true));
  end if;
  if not exists (select 1 from pg_policies where schemaname = current_schema() and tablename = 'projects' and policyname = 'projects_tenant') then
    create policy projects_tenant on projects using (lab_id::text = current_setting('gosu.lab_id', true));
  end if;
  if not exists (select 1 from pg_policies where schemaname = current_schema() and tablename = 'work_items' and policyname = 'work_items_tenant') then
    create policy work_items_tenant on work_items using (project_id::text = current_setting('gosu.project_id', true));
  end if;
  if not exists (select 1 from pg_policies where schemaname = current_schema() and tablename = 'visible_chat_messages' and policyname = 'visible_chat_tenant') then
    create policy visible_chat_tenant on visible_chat_messages using (project_id::text = current_setting('gosu.project_id', true));
  end if;
  if not exists (select 1 from pg_policies where schemaname = current_schema() and tablename = 'run_summaries' and policyname = 'run_summaries_tenant') then
    create policy run_summaries_tenant on run_summaries using (project_id::text = current_setting('gosu.project_id', true));
  end if;
  if not exists (select 1 from pg_policies where schemaname = current_schema() and tablename = 'approval_records' and policyname = 'approval_records_tenant') then
    create policy approval_records_tenant on approval_records using (
      lab_id::text = current_setting('gosu.lab_id', true)
      and project_id::text = current_setting('gosu.project_id', true)
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname = current_schema() and tablename = 'audit_events' and policyname = 'audit_events_tenant') then
    create policy audit_events_tenant on audit_events using (
      lab_id::text = current_setting('gosu.lab_id', true)
      and project_id::text = current_setting('gosu.project_id', true)
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname = current_schema() and tablename = 'sync_outbox' and policyname = 'sync_outbox_tenant') then
    create policy sync_outbox_tenant on sync_outbox using (
      lab_id::text = current_setting('gosu.lab_id', true)
      and project_id::text = current_setting('gosu.project_id', true)
    ) with check (
      lab_id::text = current_setting('gosu.lab_id', true)
      and project_id::text = current_setting('gosu.project_id', true)
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname = current_schema() and tablename = 'idempotency_keys' and policyname = 'idempotency_keys_tenant') then
    create policy idempotency_keys_tenant on idempotency_keys using (
      lab_id::text = current_setting('gosu.lab_id', true)
      and project_id::text = current_setting('gosu.project_id', true)
    ) with check (
      lab_id::text = current_setting('gosu.lab_id', true)
      and project_id::text = current_setting('gosu.project_id', true)
    );
  end if;
end $$;
