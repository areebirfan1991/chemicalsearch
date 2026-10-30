CREATE TABLE public.access_passwords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  password text NOT NULL UNIQUE,
  frozen boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.access_passwords TO service_role;
ALTER TABLE public.access_passwords ENABLE ROW LEVEL SECURITY;
INSERT INTO public.access_passwords (password) VALUES
('chemical@123'),('chemical@222'),('chemical@333'),('chemical@444'),('chemical@555'),('chemical@666');