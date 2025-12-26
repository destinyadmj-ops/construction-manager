-- CreateEnum
CREATE TYPE "AccountingType" AS ENUM ('EXPENSE', 'LABOR', 'ACCOUNTS_RECEIVABLE');

-- AlterTable
ALTER TABLE "WorkEntry" ADD COLUMN     "accountingMeta" JSONB,
ADD COLUMN     "accountingType" "AccountingType",
ADD COLUMN     "amount" DECIMAL(65,30),
ADD COLUMN     "department" TEXT,
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "taxCategory" TEXT;
