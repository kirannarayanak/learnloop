-- LearnLoop — core schema (Postgres 15+ / Supabase)
-- Design notes live in docs/03-data-model.md. Run order: this file, then db/policies.sql.

create extension if not exists "uuid-ossp";
create extension if not exists vector;      -- pgvector: dedupe + semantic search
create extension if not exists pg_trgm;     -- fuzzy title matching

-- ============================================================= identity
create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  handle          text unique,
  display_name    text,
  locale          text not null default 'en',
  country         text,                      -- drives PPP pricing tier
  timezone        text not null default 'UTC',
  daily_goal_min  int  not null default 15,
  tier            text not null default 'free' check (tier in ('free','pro','org')),
  tutor_turns_used int not null default 0,    -- resets monthly; see 05-economics.md
  tutor_period_start date not null default current_date,
  created_at      timestamptz not null default now()
);

-- ============================================================= domain + skill graph
-- A skill is one teachable, testable idea. Paths are routes through the skill graph,
-- so the same skill is reused across every path that needs it (and mastery transfers).
create table domains (
  id          uuid primary key default uuid_generate_v4(),
  slug        text unique not null,
  title       text not null,
  description text,
  parent_id   uuid references domains(id) on delete set null
);

create table skills (
  id            uuid primary key default uuid_generate_v4(),
  domain_id     uuid not null references domains(id) on delete cascade,
  slug          text not null,
  title         text not null,
  statement     text not null,              -- "can do X" — must be observable
  bloom_level   text check (bloom_level in ('remember','understand','apply','analyze','evaluate','create')),
  est_minutes   int  not null default 10,
  embedding     vector(1024),               -- near-duplicate detection across domains
  created_at    timestamptz not null default now(),
  unique (domain_id, slug)
);
create index on skills using hnsw (embedding vector_cosine_ops);  -- hnsw: no training pass, good recall on a small table
create index on skills using gin (title gin_trgm_ops);

-- Prerequisite DAG. Acyclicity is enforced in the engine, not by a constraint —
-- see engine/graph/validate.ts. A cycle here is a content bug, and it is fatal.
create table skill_edges (
  prereq_id   uuid not null references skills(id) on delete cascade,
  skill_id    uuid not null references skills(id) on delete cascade,
  strength    real not null default 1.0 check (strength > 0 and strength <= 1),
  primary key (prereq_id, skill_id),
  check (prereq_id <> skill_id)
);

-- ============================================================= provenance
-- Every generated claim traces to a source. Non-negotiable: see docs/07-risks.md.
create table sources (
  id            uuid primary key default uuid_generate_v4(),
  kind          text not null check (kind in ('url','pdf','repo','video','paper','syllabus','manual')),
  uri           text,
  title         text,
  author        text,
  license       text,                        -- null = unknown; blocks publication
  content_hash  text not null,               -- change here invalidates derived content
  retrieved_at  timestamptz not null default now(),
  raw_ref       text,                        -- R2 object key for the archived original
  unique (content_hash)
);

-- ============================================================= paths
create table paths (
  id             uuid primary key default uuid_generate_v4(),
  domain_id      uuid not null references domains(id),
  slug           text unique not null,
  title          text not null,
  summary        text,
  level          text check (level in ('intro','intermediate','advanced')),
  est_hours      numeric(5,1),
  locale         text not null default 'en',
  status         text not null default 'draft'
                 check (status in ('draft','in_review','published','deprecated')),
  owner_org_id   uuid,                       -- null = public catalogue; set = private to an org
  created_by     uuid references profiles(id),
  prompt_version text,                       -- which generator produced it (reproducibility)
  created_at     timestamptz not null default now(),
  published_at   timestamptz
);

create table path_items (
  id        uuid primary key default uuid_generate_v4(),
  path_id   uuid not null references paths(id) on delete cascade,
  position  int  not null,
  kind      text not null check (kind in ('lesson','quiz','project','checkpoint')),
  lesson_id uuid,                            -- fk added after lessons
  title     text not null,
  unique (path_id, position)
);

-- ============================================================= lessons + exercises
create table lessons (
  id            uuid primary key default uuid_generate_v4(),
  skill_id      uuid not null references skills(id) on delete cascade,
  locale        text not null default 'en',
  title         text not null,
  body_md       text not null,               -- MDX: renders offline, embeds widgets
  est_minutes   int not null default 8,
  gen_model     text,                        -- audit trail: what wrote this
  gen_cost_usd  numeric(10,6),
  verify_state  text not null default 'unverified'
                check (verify_state in ('unverified','auto_passed','auto_failed','human_approved','disputed')),
  embedding     vector(1024),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table path_items add constraint path_items_lesson_fk
  foreign key (lesson_id) references lessons(id) on delete set null;

create table lesson_sources (
  lesson_id uuid not null references lessons(id) on delete cascade,
  source_id uuid not null references sources(id) on delete cascade,
  quote     text,                            -- the span the claim rests on
  primary key (lesson_id, source_id)
);

create table exercises (
  id            uuid primary key default uuid_generate_v4(),
  skill_id      uuid not null references skills(id) on delete cascade,
  lesson_id     uuid references lessons(id) on delete set null,
  locale        text not null default 'en',
  kind          text not null check (kind in ('mcq','multi','cloze','short','code','numeric','order')),
  prompt_md     text not null,
  answer        jsonb not null,              -- shape depends on kind; validated in engine
  explanation_md text,                       -- shown after the attempt, right or wrong
  difficulty    real not null default 0.5 check (difficulty between 0 and 1),
  discrimination real,                       -- learned from attempts; see 04-content-pipeline
  verify_state  text not null default 'unverified',
  created_at    timestamptz not null default now()
);
create index on exercises (skill_id, verify_state);

-- ============================================================= learning state
create table enrollments (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references profiles(id) on delete cascade,
  path_id     uuid not null references paths(id) on delete cascade,
  cohort_id   uuid,
  started_at  timestamptz not null default now(),
  completed_at timestamptz,
  last_item   int not null default 0,
  unique (user_id, path_id)
);

-- Append-only. This is what makes offline sync trivial: nothing to merge.
create table attempts (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references profiles(id) on delete cascade,
  exercise_id  uuid not null references exercises(id) on delete cascade,
  response     jsonb,
  correct      boolean not null,
  rating       int check (rating between 1 and 4),  -- FSRS: again/hard/good/easy
  ms_elapsed   int,
  client_id    text,                          -- idempotency key from the offline queue
  attempted_at timestamptz not null default now(),
  unique (user_id, client_id)
);
create index on attempts (user_id, attempted_at desc);

-- FSRS state, one row per (learner, skill). Do not invent a scheduler; FSRS is MIT.
create table mastery (
  user_id      uuid not null references profiles(id) on delete cascade,
  skill_id     uuid not null references skills(id) on delete cascade,
  state        text not null default 'new' check (state in ('new','learning','review','relearning')),
  stability    real not null default 0,
  difficulty   real not null default 0,
  due          timestamptz,
  reps         int  not null default 0,
  lapses       int  not null default 0,
  last_review  timestamptz,
  primary key (user_id, skill_id)
);
create index on mastery (user_id, due) where due is not null;

-- ============================================================= quality control
create table reviews (
  id         uuid primary key default uuid_generate_v4(),
  entity     text not null check (entity in ('lesson','exercise','path','skill')),
  entity_id  uuid not null,
  reviewer_id uuid references profiles(id),
  verdict    text not null check (verdict in ('approve','reject','needs_edit')),
  notes      text,
  is_expert  boolean not null default false,
  created_at timestamptz not null default now()
);
create index on reviews (entity, entity_id);

create table flags (
  id         uuid primary key default uuid_generate_v4(),
  entity     text not null,
  entity_id  uuid not null,
  user_id    uuid references profiles(id) on delete set null,
  reason     text not null check (reason in ('incorrect','outdated','unclear','offensive','broken','other')),
  detail     text,
  status     text not null default 'open' check (status in ('open','triaged','fixed','rejected')),
  created_at timestamptz not null default now()
);

-- ============================================================= i18n
create table translations (
  id         uuid primary key default uuid_generate_v4(),
  entity     text not null,
  entity_id  uuid not null,
  field      text not null,
  locale     text not null,
  value      text not null,
  provenance text not null default 'machine' check (provenance in ('machine','community','expert')),
  created_at timestamptz not null default now(),
  unique (entity, entity_id, field, locale)
);

-- ============================================================= orgs (revenue)
create table orgs (
  id         uuid primary key default uuid_generate_v4(),
  slug       text unique not null,
  name       text not null,
  plan       text not null default 'trial' check (plan in ('trial','school','bootcamp','enterprise','ngo')),
  seats      int not null default 0,
  country    text,
  created_at timestamptz not null default now()
);
alter table paths add constraint paths_org_fk
  foreign key (owner_org_id) references orgs(id) on delete cascade;

create table org_members (
  org_id  uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role    text not null default 'learner' check (role in ('owner','admin','instructor','learner')),
  primary key (org_id, user_id)
);

create table cohorts (
  id        uuid primary key default uuid_generate_v4(),
  org_id    uuid not null references orgs(id) on delete cascade,
  path_id   uuid not null references paths(id),
  name      text not null,
  starts_on date,
  ends_on   date
);
alter table enrollments add constraint enrollments_cohort_fk
  foreign key (cohort_id) references cohorts(id) on delete set null;

-- ============================================================= credentials
create table credentials (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references profiles(id) on delete cascade,
  path_id     uuid references paths(id),
  skill_id    uuid references skills(id),
  kind        text not null check (kind in ('path_completion','skill_verified','assessment')),
  evidence    jsonb not null,                -- attempt ids, scores, proctoring signals
  issued_at   timestamptz not null default now(),
  public_slug text unique not null,          -- /verify/<slug> — anyone can check it
  revoked_at  timestamptz
);

-- ============================================================= generation pipeline
create table generation_jobs (
  id           uuid primary key default uuid_generate_v4(),
  kind         text not null check (kind in ('ingest','graph','lesson','exercise','verify','translate','bundle')),
  payload      jsonb not null,
  status       text not null default 'queued'
               check (status in ('queued','running','done','failed','cancelled')),
  attempts     int not null default 0,
  priority     int not null default 100,
  cost_usd     numeric(10,6),
  error        text,
  locked_until timestamptz,                  -- lease-based: crashed workers self-release
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index on generation_jobs (status, priority, created_at) where status = 'queued';

-- The cost killer: keyed on inputs, so re-running the pipeline is free until
-- a source or a prompt version actually changes.
create table content_cache (
  cache_key   text primary key,              -- hash(prompt_version + model + inputs)
  model       text not null,
  output      jsonb not null,
  input_tok   int,
  output_tok  int,
  cost_usd    numeric(10,6),
  hits        int not null default 0,
  created_at  timestamptz not null default now()
);

-- Offline bundles on R2, one per (path, locale).
create table path_bundles (
  path_id    uuid not null references paths(id) on delete cascade,
  locale     text not null,
  r2_key     text not null,
  bytes      int not null,
  sha256     text not null,
  built_at   timestamptz not null default now(),
  primary key (path_id, locale)
);
