-- Add email field for Partner (Outlook recipient)
ALTER TABLE IF EXISTS "Partner" ADD COLUMN IF NOT EXISTS "email" TEXT;
