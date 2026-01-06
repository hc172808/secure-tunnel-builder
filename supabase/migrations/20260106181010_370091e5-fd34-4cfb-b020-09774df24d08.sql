-- Grant admin role to netlifegy@gmail.com
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role 
FROM auth.users 
WHERE email = 'netlifegy@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- Add signup_enabled setting if not exists
INSERT INTO public.server_settings (setting_key, setting_value, description)
VALUES ('signup_enabled', 'true', 'Controls whether new user signups are allowed')
ON CONFLICT (setting_key) DO NOTHING;