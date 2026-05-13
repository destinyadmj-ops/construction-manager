ALTER TABLE "ScheduleChangeHistory"
ADD COLUMN "beforeGroups" JSONB,
ADD COLUMN "afterGroups" JSONB;