-- CreateTable
CREATE TABLE "ScheduleChangeHistory" (
    "id" TEXT NOT NULL,
    "kind" "WorkEntryKind" NOT NULL DEFAULT 'NORMAL',
    "targetUserId" TEXT NOT NULL,
    "editorUserId" TEXT,
    "editorLoginMemoryId" TEXT,
    "dayYmd" TEXT NOT NULL,
    "targetUserLabel" TEXT NOT NULL DEFAULT '',
    "projectLabel" TEXT NOT NULL DEFAULT '',
    "targetLabel" TEXT NOT NULL DEFAULT '',
    "beforeValue" TEXT NOT NULL DEFAULT '',
    "afterValue" TEXT NOT NULL DEFAULT '',
    "editorLabel" TEXT NOT NULL DEFAULT '',
    "editorIpHash" TEXT,
    "editorUserAgentHash" TEXT,
    "editorHost" TEXT NOT NULL DEFAULT '',
    "editorPlatform" TEXT NOT NULL DEFAULT '',
    "editorLanguage" TEXT NOT NULL DEFAULT '',
    "editorTimeZone" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleChangeHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleChangeHistory_kind_createdAt_idx" ON "ScheduleChangeHistory"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduleChangeHistory_dayYmd_createdAt_idx" ON "ScheduleChangeHistory"("dayYmd", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduleChangeHistory_targetUserId_dayYmd_createdAt_idx" ON "ScheduleChangeHistory"("targetUserId", "dayYmd", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduleChangeHistory_editorUserId_createdAt_idx" ON "ScheduleChangeHistory"("editorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "ScheduleChangeHistory" ADD CONSTRAINT "ScheduleChangeHistory_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleChangeHistory" ADD CONSTRAINT "ScheduleChangeHistory_editorUserId_fkey" FOREIGN KEY ("editorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleChangeHistory" ADD CONSTRAINT "ScheduleChangeHistory_editorLoginMemoryId_fkey" FOREIGN KEY ("editorLoginMemoryId") REFERENCES "UserLoginMemory"("id") ON DELETE SET NULL ON UPDATE CASCADE;