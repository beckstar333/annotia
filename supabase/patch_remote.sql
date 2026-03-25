-- Comprehensive patch to bring remote DB up to date
-- Run via: npx supabase db execute -f supabase/patch_remote.sql

-- Add missing columns to existing tables
alter table public.papers
  add column if not exists confidence_score_avg numeric(3,2),
  add column if not exists confidence_score_count integer default 0,
  add column if not exists is_retracted boolean default false,
  add column if not exists source text,
  add column if not exists field text,
  add column if not exists paper_type text,
  add column if not exists license_url text,
  add column if not exists pdf_url text,
  add column if not exists view_count integer default 0,
  add column if not exists summary_count integer default 0;

do $$ begin
  create type retraction_type as enum ('retraction', 'correction', 'expression_of_concern');
exception when duplicate_object then null;
end $$;

alter table public.papers add column if not exists retraction_type retraction_type;

alter table public.comments add column if not exists vote_score integer default 0;

alter table public.profiles
  add column if not exists is_verified boolean default false,
  add column if not exists fields_of_interest text[];

-- Create enums for flags
do $$ begin create type flag_target_type as enum ('summary', 'comment'); exception when duplicate_object then null; end $$;
do $$ begin create type flag_reason as enum ('inaccurate','misleading','outdated','missing_context','biased','spam','other'); exception when duplicate_object then null; end $$;
do $$ begin create type flag_status as enum ('open','reviewed','resolved','dismissed'); exception when duplicate_object then null; end $$;

-- New tables
create table if not exists public.confidence_votes (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  reason text check (char_length(reason) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(paper_id, user_id)
);
create index if not exists idx_confidence_paper on public.confidence_votes(paper_id);

create table if not exists public.flags (
  id uuid primary key default gen_random_uuid(),
  target_type flag_target_type not null,
  paper_id uuid references public.papers(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete set null,
  reason flag_reason not null,
  detail text check (char_length(detail) <= 2000),
  status flag_status not null default 'open',
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (target_type = 'summary' and paper_id is not null) or
    (target_type = 'comment' and comment_id is not null)
  )
);
create index if not exists idx_flags_status on public.flags(status) where status = 'open';
create index if not exists idx_flags_paper on public.flags(paper_id);

create table if not exists public.retractions (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete cascade,
  type retraction_type not null,
  source text,
  source_url text,
  reason text,
  retracted_at date,
  discovered_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_retractions_paper on public.retractions(paper_id);

create table if not exists public.comment_votes (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  unique(comment_id, user_id)
);
create index if not exists idx_comment_votes_comment on public.comment_votes(comment_id);

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  is_public boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collection_papers (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  paper_id uuid not null references public.papers(id) on delete cascade,
  added_at timestamptz not null default now(),
  unique(collection_id, paper_id)
);

-- Indexes
create index if not exists idx_comments_parent on public.comments(parent_id);

-- RLS on new tables
alter table public.confidence_votes enable row level security;
alter table public.flags enable row level security;
alter table public.retractions enable row level security;
alter table public.comment_votes enable row level security;
alter table public.collections enable row level security;
alter table public.collection_papers enable row level security;

-- RLS policies (idempotent via DO block)
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Comments are viewable by everyone' and tablename = 'comments') then
    create policy "Comments are viewable by everyone" on public.comments for select using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Authenticated users can post comments' and tablename = 'comments') then
    create policy "Authenticated users can post comments" on public.comments for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can delete their own comments' and tablename = 'comments') then
    create policy "Users can delete their own comments" on public.comments for delete using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Confidence votes are viewable by everyone') then
    create policy "Confidence votes are viewable by everyone" on public.confidence_votes for select using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can submit their own confidence vote') then
    create policy "Users can submit their own confidence vote" on public.confidence_votes for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can update their own confidence vote') then
    create policy "Users can update their own confidence vote" on public.confidence_votes for update using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can view their own flags') then
    create policy "Users can view their own flags" on public.flags for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Authenticated users can create flags') then
    create policy "Authenticated users can create flags" on public.flags for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Retractions are viewable by everyone') then
    create policy "Retractions are viewable by everyone" on public.retractions for select using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Authenticated users can insert retractions') then
    create policy "Authenticated users can insert retractions" on public.retractions for insert with check (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Comment votes are viewable by everyone') then
    create policy "Comment votes are viewable by everyone" on public.comment_votes for select using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can vote on comments') then
    create policy "Users can vote on comments" on public.comment_votes for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can change their vote') then
    create policy "Users can change their vote" on public.comment_votes for update using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can remove their vote') then
    create policy "Users can remove their vote" on public.comment_votes for delete using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Public collections are viewable by everyone') then
    create policy "Public collections are viewable by everyone" on public.collections for select using (is_public or auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can create collections') then
    create policy "Users can create collections" on public.collections for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can update their own collections') then
    create policy "Users can update their own collections" on public.collections for update using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can delete their own collections') then
    create policy "Users can delete their own collections" on public.collections for delete using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Collection papers follow collection visibility') then
    create policy "Collection papers follow collection visibility" on public.collection_papers for select using (
      exists (select 1 from public.collections c where c.id = collection_id and (c.is_public or c.user_id = auth.uid()))
    );
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can add papers to their collections') then
    create policy "Users can add papers to their collections" on public.collection_papers for insert with check (
      exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid())
    );
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can remove papers from their collections') then
    create policy "Users can remove papers from their collections" on public.collection_papers for delete using (
      exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid())
    );
  end if;
end $$;

-- Triggers and functions
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'collections_updated_at') then
    create trigger collections_updated_at before update on public.collections for each row execute function public.update_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'confidence_votes_updated_at') then
    create trigger confidence_votes_updated_at before update on public.confidence_votes for each row execute function public.update_updated_at();
  end if;
end $$;

create or replace function public.update_confidence_score()
returns trigger as $$
begin
  update public.papers set
    confidence_score_avg = (select round(avg(score)::numeric, 2) from public.confidence_votes where paper_id = coalesce(new.paper_id, old.paper_id)),
    confidence_score_count = (select count(*) from public.confidence_votes where paper_id = coalesce(new.paper_id, old.paper_id))
  where id = coalesce(new.paper_id, old.paper_id);
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'confidence_vote_changed') then
    create trigger confidence_vote_changed after insert or update or delete on public.confidence_votes for each row execute function public.update_confidence_score();
  end if;
end $$;

create or replace function public.update_comment_vote_score()
returns trigger as $$
begin
  update public.comments set vote_score = (
    select coalesce(sum(value), 0) from public.comment_votes where comment_id = coalesce(new.comment_id, old.comment_id)
  ) where id = coalesce(new.comment_id, old.comment_id);
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'comment_vote_changed') then
    create trigger comment_vote_changed after insert or update or delete on public.comment_votes for each row execute function public.update_comment_vote_score();
  end if;
end $$;

create or replace function public.increment_view_count(paper_doi text)
returns void as $$
begin
  update public.papers set view_count = coalesce(view_count, 0) + 1 where doi = paper_doi;
end;
$$ language plpgsql security definer;
