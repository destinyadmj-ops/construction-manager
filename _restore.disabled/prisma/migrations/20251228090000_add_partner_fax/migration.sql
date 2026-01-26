-- Add Partner.fax (idempotent)
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "fax" TEXT;
