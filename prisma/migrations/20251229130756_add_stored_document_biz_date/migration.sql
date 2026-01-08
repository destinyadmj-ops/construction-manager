-- AlterTable
ALTER TABLE "StoredDocument" ADD COLUMN     "bizDateYmd" TEXT;

-- CreateIndex
CREATE INDEX "StoredDocument_kind_bizDateYmd_idx" ON "StoredDocument"("kind", "bizDateYmd");
