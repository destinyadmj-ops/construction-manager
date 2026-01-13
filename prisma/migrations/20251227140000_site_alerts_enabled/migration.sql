-- Add per-site alertsEnabled switch (idempotent)
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "alertsEnabled" BOOLEAN NOT NULL DEFAULT TRUE;
