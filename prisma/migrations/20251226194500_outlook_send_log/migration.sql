DO $$
BEGIN
  CREATE TYPE "OutlookMailKind" AS ENUM ('REPORT', 'INVOICE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "OutlookMailStatus" AS ENUM ('SENT', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "OutlookSendLog" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "kind" "OutlookMailKind" NOT NULL,
  "status" "OutlookMailStatus" NOT NULL,
  "toEmail" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OutlookSendLog_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  ALTER TABLE "OutlookSendLog"
    ADD CONSTRAINT "OutlookSendLog_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "OutlookSendLog"
    ADD CONSTRAINT "OutlookSendLog_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "OutlookSendLog_partnerId_createdAt_idx" ON "OutlookSendLog"("partnerId", "createdAt");
CREATE INDEX IF NOT EXISTS "OutlookSendLog_siteId_createdAt_idx" ON "OutlookSendLog"("siteId", "createdAt");
CREATE INDEX IF NOT EXISTS "OutlookSendLog_createdAt_idx" ON "OutlookSendLog"("createdAt");
