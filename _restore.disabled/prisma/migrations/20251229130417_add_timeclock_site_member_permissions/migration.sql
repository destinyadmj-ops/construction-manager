-- CreateEnum
CREATE TYPE "StoredDocumentKind" AS ENUM ('REPORT', 'INVOICE', 'BUSINESS_CARD', 'PHOTO');

-- CreateEnum
CREATE TYPE "WorkEntryKind" AS ENUM ('NORMAL', 'DAILY');

-- CreateEnum
CREATE TYPE "SiteKind" AS ENUM ('NORMAL', 'DAILY');

-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('NORMAL', 'DAILY');

-- AlterTable
ALTER TABLE "OutlookSendLog" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "address" TEXT,
ADD COLUMN     "caution" TEXT,
ADD COLUMN     "detail" TEXT,
ADD COLUMN     "emails" JSONB,
ADD COLUMN     "extraFields" JSONB,
ADD COLUMN     "phone" TEXT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "amount" DECIMAL(65,30),
ADD COLUMN     "caution" TEXT,
ADD COLUMN     "defaultWorkMinutes" INTEGER,
ADD COLUMN     "detail" TEXT,
ADD COLUMN     "kind" "SiteKind" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "pace" TEXT,
ADD COLUMN     "peopleCount" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canEditSchedule" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kind" "UserKind" NOT NULL DEFAULT 'NORMAL';

-- AlterTable
ALTER TABLE "WorkEntry" ADD COLUMN     "kind" "WorkEntryKind" NOT NULL DEFAULT 'NORMAL';

-- CreateTable
CREATE TABLE "UserUiSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserUiSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteMember" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeClock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "siteId" TEXT,
    "inAt" TIMESTAMP(3) NOT NULL,
    "outAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeClock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredDocument" (
    "id" TEXT NOT NULL,
    "siteId" TEXT,
    "partnerId" TEXT,
    "kind" "StoredDocumentKind" NOT NULL,
    "subject" TEXT,
    "tags" JSONB,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storedPath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoredDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserUiSetting_userId_key_idx" ON "UserUiSetting"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "UserUiSetting_userId_key_key" ON "UserUiSetting"("userId", "key");

-- CreateIndex
CREATE INDEX "SiteMember_siteId_idx" ON "SiteMember"("siteId");

-- CreateIndex
CREATE INDEX "SiteMember_userId_idx" ON "SiteMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteMember_siteId_userId_key" ON "SiteMember"("siteId", "userId");

-- CreateIndex
CREATE INDEX "TimeClock_userId_inAt_idx" ON "TimeClock"("userId", "inAt");

-- CreateIndex
CREATE INDEX "TimeClock_siteId_inAt_idx" ON "TimeClock"("siteId", "inAt");

-- CreateIndex
CREATE INDEX "TimeClock_userId_outAt_idx" ON "TimeClock"("userId", "outAt");

-- CreateIndex
CREATE INDEX "StoredDocument_siteId_createdAt_idx" ON "StoredDocument"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "StoredDocument_partnerId_createdAt_idx" ON "StoredDocument"("partnerId", "createdAt");

-- CreateIndex
CREATE INDEX "StoredDocument_kind_createdAt_idx" ON "StoredDocument"("kind", "createdAt");

-- AddForeignKey
ALTER TABLE "UserUiSetting" ADD CONSTRAINT "UserUiSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteMember" ADD CONSTRAINT "SiteMember_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteMember" ADD CONSTRAINT "SiteMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClock" ADD CONSTRAINT "TimeClock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClock" ADD CONSTRAINT "TimeClock_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredDocument" ADD CONSTRAINT "StoredDocument_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredDocument" ADD CONSTRAINT "StoredDocument_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
