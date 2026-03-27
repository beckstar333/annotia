-- User feedback table
CREATE TABLE IF NOT EXISTS public.feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id),
  type        text NOT NULL DEFAULT 'general', -- general, bug, feature, other
  message     text NOT NULL,
  page_url    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can submit feedback" ON public.feedback FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can read feedback" ON public.feedback FOR SELECT USING (true);
