-- Custom paper alerts for Pro users
CREATE TABLE IF NOT EXISTS public.paper_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query       text NOT NULL,
  field       text,
  is_active   boolean DEFAULT true,
  last_checked timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_paper_alerts_user ON public.paper_alerts(user_id);
CREATE INDEX idx_paper_alerts_active ON public.paper_alerts(is_active) WHERE is_active = true;

ALTER TABLE public.paper_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own alerts" ON public.paper_alerts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users create own alerts" ON public.paper_alerts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own alerts" ON public.paper_alerts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own alerts" ON public.paper_alerts FOR DELETE USING (auth.uid() = user_id);
