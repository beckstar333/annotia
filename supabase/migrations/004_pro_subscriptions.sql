-- Pro subscription tracking on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_pro              boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_customer_id  text UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS pro_since           timestamptz,
  ADD COLUMN IF NOT EXISTS pro_until           timestamptz;
