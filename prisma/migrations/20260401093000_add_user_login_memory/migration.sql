-- CreateTable
CREATE TABLE "UserLoginMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fingerprintHash" TEXT NOT NULL,
    "ipHash" TEXT,
    "userAgentHash" TEXT,
    "host" TEXT NOT NULL DEFAULT '',
    "platform" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT '',
    "timeZone" TEXT NOT NULL DEFAULT '',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserLoginMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserLoginMemory_fingerprintHash_key" ON "UserLoginMemory"("fingerprintHash");

-- CreateIndex
CREATE INDEX "UserLoginMemory_userId_lastSeenAt_idx" ON "UserLoginMemory"("userId", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "UserLoginMemory" ADD CONSTRAINT "UserLoginMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;