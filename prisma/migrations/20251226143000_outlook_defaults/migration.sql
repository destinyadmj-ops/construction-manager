-- Add Outlook defaults to Partner
ALTER TABLE IF EXISTS "Partner" ADD COLUMN IF NOT EXISTS "outlookToEmailDefault" TEXT;
ALTER TABLE IF EXISTS "Partner" ADD COLUMN IF NOT EXISTS "outlookSubjectReportDefault" TEXT;
ALTER TABLE IF EXISTS "Partner" ADD COLUMN IF NOT EXISTS "outlookSubjectInvoiceDefault" TEXT;
