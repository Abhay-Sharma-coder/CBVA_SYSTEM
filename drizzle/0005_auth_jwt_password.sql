-- Password authentication and reset fields for users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_token text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_expires timestamp with time zone;
