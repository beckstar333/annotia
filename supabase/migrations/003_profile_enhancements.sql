-- Add ORCID, LinkedIn, and structured user_type to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS orcid       text,
  ADD COLUMN IF NOT EXISTS linkedin    text,
  ADD COLUMN IF NOT EXISTS user_type   text;  -- MD, NP, scientist, pharmacist, psychologist, other
