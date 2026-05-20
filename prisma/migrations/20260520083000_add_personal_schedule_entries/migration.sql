-- CreateTable
CREATE TABLE "PersonalScheduleEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayYmd" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "color" TEXT NOT NULL DEFAULT 'emerald',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalScheduleEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonalScheduleEntry_userId_dayYmd_slotIndex_key" ON "PersonalScheduleEntry"("userId", "dayYmd", "slotIndex");

-- CreateIndex
CREATE INDEX "PersonalScheduleEntry_userId_dayYmd_idx" ON "PersonalScheduleEntry"("userId", "dayYmd");

-- CreateIndex
CREATE INDEX "PersonalScheduleEntry_dayYmd_userId_idx" ON "PersonalScheduleEntry"("dayYmd", "userId");

-- AddForeignKey
ALTER TABLE "PersonalScheduleEntry" ADD CONSTRAINT "PersonalScheduleEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;