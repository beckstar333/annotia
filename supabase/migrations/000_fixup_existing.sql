-- ============================================================
-- Fixup: align existing tables with 001_initial_schema.sql
-- The comments table was created earlier with "content" instead
-- of "body" and is missing parent_id. This migration patches
-- the existing tables so 001 can run cleanly.
-- ============================================================

-- Comments: rename content -> body, add parent_id
alter table public.comments
  add column if not exists parent_id uuid references public.comments(id) on delete cascade;

-- Rename content to body if content exists and body doesn't
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'comments' and column_name = 'content'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'comments' and column_name = 'body'
  ) then
    alter table public.comments rename column content to body;
  end if;
end;
$$;

-- Add check constraint on body length if not present
do $$
begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_schema = 'public' and constraint_name like '%comments_body%'
  ) then
    alter table public.comments add constraint comments_body_length check (char_length(body) <= 5000);
  end if;
end;
$$;
