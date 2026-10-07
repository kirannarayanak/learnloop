-- Wave 0 beachheads. All four, per the 2026-10-07 decision in docs/00-decisions.md.
-- risk_tier is what gates auto-publication (see publish_lesson() in schema.sql):
--   low    => auto_passed publishes
--   medium => auto_passed publishes, sampled for human review
--   high   => human_approved REQUIRED. No exceptions.

insert into domains (slug, title, description, risk_tier) values

  -- Beachhead A — the engine's proving ground. Low risk: a wrong answer about a
  -- JS framework costs a confused afternoon, not a life. Kiran can personally judge
  -- content quality here, which is what makes wave 0 measurable at all.
  ('emerging-tech', 'Emerging Tech for Working Engineers',
   'AI and agents, new frameworks, new tooling, new standards. The freshness beachhead: content regenerates as sources change.',
   'low'),

  -- Beachhead B — narrow and deep, institutions are the buyer.
  ('fintech-eng', 'Fintech & Payments Engineering',
   'Card schemes, ISO 20022, settlement, reconciliation, compliance engineering.',
   'medium'),

  -- Beachhead C — volume. Medium rather than high: the syllabus is a fixed public
  -- document, so claims are checkable against an authoritative source. Still sampled.
  ('exam-prep', 'Competitive Exam Preparation',
   'JEE, NEET, UPSC, GATE. Source of truth is the published syllabus and past papers.',
   'medium'),

  -- Beachhead D — highest mission value, strictest gate. Minors are involved, so
  -- the data-protection policy in docs/07-risks.md must be settled BEFORE any
  -- school cohort is onboarded, not after.
  ('school-curriculum', 'School Curriculum (K-12)',
   'Board syllabi. Human-approved only; see the minors policy before onboarding any school.',
   'high')

on conflict (slug) do update
  set title       = excluded.title,
      description = excluded.description,
      risk_tier   = excluded.risk_tier;
