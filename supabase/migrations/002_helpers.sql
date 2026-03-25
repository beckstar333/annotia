-- ============================================================
-- Annotia Helpers
-- 002_helpers.sql
--
-- 1. increment_view_count RPC
-- 2. Retractions insert policy (missing from 001)
-- ============================================================

-- ── View Count RPC ────────────────────────────────────────────
-- Atomically increment view_count on a paper by DOI.
-- Called from the frontend after paper upsert.
create or replace function public.increment_view_count(paper_doi text)
returns void as $$
begin
  update public.papers
  set view_count = coalesce(view_count, 0) + 1
  where doi = paper_doi;
end;
$$ language plpgsql security definer;

-- ── Retractions insert policy ─────────────────────────────────
-- Authenticated users (and the app itself via service role) can
-- insert retraction records.  The 001 migration only created a
-- SELECT policy; inserts were blocked by RLS.
create policy "Authenticated users can insert retractions"
  on public.retractions for insert
  with check (auth.role() = 'authenticated');
