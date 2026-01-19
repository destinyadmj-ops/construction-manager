-- Add per-site schedule label default color.
ALTER TABLE "Site" ADD COLUMN "scheduleLabelColor" TEXT NOT NULL DEFAULT 'default';
