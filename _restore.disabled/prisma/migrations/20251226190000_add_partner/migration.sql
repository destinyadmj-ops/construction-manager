-- CreateTable (idempotent)
CREATE TABLE IF NOT EXISTS "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "notes" TEXT,
    "outlookToEmailDefault" TEXT,
    "outlookSubjectReportDefault" TEXT,
    "outlookSubjectInvoiceDefault" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- Ensure columns exist even if Partner table already existed
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "outlookToEmailDefault" TEXT;
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "outlookSubjectReportDefault" TEXT;
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "outlookSubjectInvoiceDefault" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Partner_name_key" ON "Partner"("name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Partner_name_idx" ON "Partner"("name");
