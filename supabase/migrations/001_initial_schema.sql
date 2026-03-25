-- ============================================================
-- Annotia Database Schema
-- 001_initial_schema.sql
--
-- Part 1: Existing tables (capturing current state)
-- Part 2: New tables (confidence votes, flags, retractions, etc.)
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- PART 1: EXISTING TABLES
-- These reflect what the app currently uses.
-- ──────────────────────────────────────────────────────────────

-- Profiles: created on signup via Supabase Auth trigger
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        text,        -- clinician, researcher, student, etc.
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Papers: core entity, keyed by DOI
create table if not exists public.papers (
  id                    uuid primary key default gen_random_uuid(),
  doi                   text unique not null,
  title                 text not null,
  authors               text,
  journal               text,
  year                  text,
  abstract              text,
  subject               text,
  is_preprint           boolean default false,
  is_open_access        boolean default false,
  -- AI-generated summary fields
  summary_what_studied  text,
  summary_how_studied   text,
  summary_what_found    text,
  summary_confidence    text,
  summary_real_world    text,
  summary_why_care      text,
  summary_jargon        jsonb default '[]'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_papers_doi on public.papers(doi);

-- Saved papers: user bookmarks
create table if not exists public.saved_papers (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  paper_id   uuid not null references public.papers(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, paper_id)
);

-- Comments: threaded discussion on papers
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  paper_id   uuid not null references public.papers(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  parent_id  uuid references public.comments(id) on delete cascade,
  body       text not null check (char_length(body) <= 5000),
  created_at timestamptz not null default now()
);

create index if not exists idx_comments_paper on public.comments(paper_id, created_at);
create index if not exists idx_comments_parent on public.comments(parent_id);

-- ──────────────────────────────────────────────────────────────
-- PART 2: NEW TABLES
-- Expanding the schema for planned features.
-- ──────────────────────────────────────────────────────────────

-- ── Confidence Votes ────────────────────────────────────────
-- Community members rate how much weight to give a paper's findings.
-- Score: 1 (very low confidence) to 5 (very high confidence)
create table if not exists public.confidence_votes (
  id         uuid primary key default gen_random_uuid(),
  paper_id   uuid not null references public.papers(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  score      smallint not null check (score between 1 and 5),
  reason     text check (char_length(reason) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(paper_id, user_id)
);

create index if not exists idx_confidence_paper on public.confidence_votes(paper_id);

-- Aggregated confidence score cached on the paper
alter table public.papers
  add column if not exists confidence_score_avg  numeric(3,2),
  add column if not exists confidence_score_count integer default 0;

-- ── Flags / Error Reports ───────────────────────────────────
-- Users can flag AI summaries or comments for inaccuracy, bias, etc.
create type flag_target_type as enum ('summary', 'comment');
create type flag_reason as enum (
  'inaccurate',
  'misleading',
  'outdated',
  'missing_context',
  'biased',
  'spam',
  'other'
);
create type flag_status as enum ('open', 'reviewed', 'resolved', 'dismissed');

create table if not exists public.flags (
  id          uuid primary key default gen_random_uuid(),
  target_type flag_target_type not null,
  paper_id    uuid references public.papers(id) on delete cascade,
  comment_id  uuid references public.comments(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete set null,
  reason      flag_reason not null,
  detail      text check (char_length(detail) <= 2000),
  status      flag_status not null default 'open',
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  -- Ensure the right target reference is set
  check (
    (target_type = 'summary' and paper_id is not null) or
    (target_type = 'comment' and comment_id is not null)
  )
);

create index if not exists idx_flags_status on public.flags(status) where status = 'open';
create index if not exists idx_flags_paper on public.flags(paper_id);

-- ── Retraction Tracking ─────────────────────────────────────
-- Tracks known retractions, corrections, and expressions of concern.
create type retraction_type as enum ('retraction', 'correction', 'expression_of_concern');

create table if not exists public.retractions (
  id           uuid primary key default gen_random_uuid(),
  paper_id     uuid not null references public.papers(id) on delete cascade,
  type         retraction_type not null,
  source       text,            -- e.g. 'retraction_watch', 'crossref', 'manual'
  source_url   text,
  reason       text,
  retracted_at date,
  discovered_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists idx_retractions_paper on public.retractions(paper_id);

-- Flag on paper for quick lookup
alter table public.papers
  add column if not exists is_retracted boolean default false,
  add column if not exists retraction_type retraction_type;

-- ── Paper Metadata (extended) ───────────────────────────────
-- Additional fields for richer paper records
alter table public.papers
  add column if not exists source       text,           -- 'crossref', 'arxiv', 'manual'
  add column if not exists field        text,           -- discipline: 'psychology', 'biology', etc.
  add column if not exists paper_type   text,           -- 'journal-article', 'preprint', 'review', etc.
  add column if not exists license_url  text,
  add column if not exists pdf_url      text,
  add column if not exists view_count   integer default 0,
  add column if not exists summary_count integer default 0;

-- ── Comment Votes ───────────────────────────────────────────
-- Upvote/downvote on comments to surface quality discussion
create table if not exists public.comment_votes (
  id         uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  value      smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  unique(comment_id, user_id)
);

create index if not exists idx_comment_votes_comment on public.comment_votes(comment_id);

-- Cached vote score on comment
alter table public.comments
  add column if not exists vote_score integer default 0;

-- ── Collections ─────────────────────────────────────────────
-- Users can organize saved papers into named collections
create table if not exists public.collections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  description text,
  is_public   boolean default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.collection_papers (
  id            uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  paper_id      uuid not null references public.papers(id) on delete cascade,
  added_at      timestamptz not null default now(),
  unique(collection_id, paper_id)
);

-- ── Profile Enhancements ────────────────────────────────────
alter table public.profiles
  add column if not exists bio             text check (char_length(bio) <= 1000),
  add column if not exists institution     text,
  add column if not exists is_verified     boolean default false,
  add column if not exists fields_of_interest text[];  -- e.g. {'psychology','neuroscience'}

-- ──────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ──────────────────────────────────────────────────────────────

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.papers enable row level security;
alter table public.saved_papers enable row level security;
alter table public.comments enable row level security;
alter table public.confidence_votes enable row level security;
alter table public.flags enable row level security;
alter table public.retractions enable row level security;
alter table public.comment_votes enable row level security;
alter table public.collections enable row level security;
alter table public.collection_papers enable row level security;

-- Profiles: public read, own write
create policy "Profiles are viewable by everyone"
  on public.profiles for select using (true);
create policy "Users can update their own profile"
  on public.profiles for update using (auth.uid() = id);
create policy "Users can insert their own profile"
  on public.profiles for insert with check (auth.uid() = id);

-- Papers: public read, authenticated insert/update
create policy "Papers are viewable by everyone"
  on public.papers for select using (true);
create policy "Authenticated users can insert papers"
  on public.papers for insert with check (auth.role() = 'authenticated');
create policy "Authenticated users can update papers"
  on public.papers for update using (auth.role() = 'authenticated');

-- Saved papers: own data only
create policy "Users can view their own saved papers"
  on public.saved_papers for select using (auth.uid() = user_id);
create policy "Users can save papers"
  on public.saved_papers for insert with check (auth.uid() = user_id);
create policy "Users can unsave papers"
  on public.saved_papers for delete using (auth.uid() = user_id);

-- Comments: public read, own write
create policy "Comments are viewable by everyone"
  on public.comments for select using (true);
create policy "Authenticated users can post comments"
  on public.comments for insert with check (auth.uid() = user_id);
create policy "Users can delete their own comments"
  on public.comments for delete using (auth.uid() = user_id);

-- Confidence votes: public read, own write
create policy "Confidence votes are viewable by everyone"
  on public.confidence_votes for select using (true);
create policy "Users can submit their own confidence vote"
  on public.confidence_votes for insert with check (auth.uid() = user_id);
create policy "Users can update their own confidence vote"
  on public.confidence_votes for update using (auth.uid() = user_id);

-- Flags: only flagging user and admins can see
create policy "Users can view their own flags"
  on public.flags for select using (auth.uid() = user_id);
create policy "Authenticated users can create flags"
  on public.flags for insert with check (auth.uid() = user_id);

-- Retractions: public read
create policy "Retractions are viewable by everyone"
  on public.retractions for select using (true);

-- Comment votes: public read, own write
create policy "Comment votes are viewable by everyone"
  on public.comment_votes for select using (true);
create policy "Users can vote on comments"
  on public.comment_votes for insert with check (auth.uid() = user_id);
create policy "Users can change their vote"
  on public.comment_votes for update using (auth.uid() = user_id);
create policy "Users can remove their vote"
  on public.comment_votes for delete using (auth.uid() = user_id);

-- Collections: public collections readable, own data writable
create policy "Public collections are viewable by everyone"
  on public.collections for select using (is_public or auth.uid() = user_id);
create policy "Users can create collections"
  on public.collections for insert with check (auth.uid() = user_id);
create policy "Users can update their own collections"
  on public.collections for update using (auth.uid() = user_id);
create policy "Users can delete their own collections"
  on public.collections for delete using (auth.uid() = user_id);

-- Collection papers: follow parent collection visibility
create policy "Collection papers follow collection visibility"
  on public.collection_papers for select using (
    exists (
      select 1 from public.collections c
      where c.id = collection_id
      and (c.is_public or c.user_id = auth.uid())
    )
  );
create policy "Users can add papers to their collections"
  on public.collection_papers for insert with check (
    exists (
      select 1 from public.collections c
      where c.id = collection_id and c.user_id = auth.uid()
    )
  );
create policy "Users can remove papers from their collections"
  on public.collection_papers for delete using (
    exists (
      select 1 from public.collections c
      where c.id = collection_id and c.user_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────────
-- FUNCTIONS & TRIGGERS
-- ──────────────────────────────────────────────────────────────

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'role', '')
  );
  return new;
end;
$$ language plpgsql security definer;

-- Only create trigger if it doesn't exist
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'on_auth_user_created'
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end;
$$;

-- Update updated_at timestamp automatically
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger papers_updated_at
  before update on public.papers
  for each row execute function public.update_updated_at();

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.update_updated_at();

create trigger collections_updated_at
  before update on public.collections
  for each row execute function public.update_updated_at();

create trigger confidence_votes_updated_at
  before update on public.confidence_votes
  for each row execute function public.update_updated_at();

-- Recalculate confidence score on vote change
create or replace function public.update_confidence_score()
returns trigger as $$
begin
  update public.papers
  set
    confidence_score_avg = (
      select round(avg(score)::numeric, 2)
      from public.confidence_votes
      where paper_id = coalesce(new.paper_id, old.paper_id)
    ),
    confidence_score_count = (
      select count(*)
      from public.confidence_votes
      where paper_id = coalesce(new.paper_id, old.paper_id)
    )
  where id = coalesce(new.paper_id, old.paper_id);
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

create trigger confidence_vote_changed
  after insert or update or delete on public.confidence_votes
  for each row execute function public.update_confidence_score();

-- Recalculate comment vote score
create or replace function public.update_comment_vote_score()
returns trigger as $$
begin
  update public.comments
  set vote_score = (
    select coalesce(sum(value), 0)
    from public.comment_votes
    where comment_id = coalesce(new.comment_id, old.comment_id)
  )
  where id = coalesce(new.comment_id, old.comment_id);
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

create trigger comment_vote_changed
  after insert or update or delete on public.comment_votes
  for each row execute function public.update_comment_vote_score();
