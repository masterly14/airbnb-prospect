-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'COOLDOWN', 'BLOCKED', 'PENDING_GMAIL', 'PENDING_CREDENTIALS', 'VERIFYING');
CREATE TYPE "BlockType" AS ENUM ('RATE_LIMIT', 'IDENTITY', 'CAPTCHA', 'OTHER');

-- CreateTable
CREATE TABLE "ProspectAccount" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "airbnbEmail" TEXT NOT NULL,
    "composioUserId" TEXT,
    "proxyHost" TEXT,
    "proxyPort" INTEGER,
    "proxyUser" TEXT,
    "proxyPass" TEXT,
    "sessionPath" TEXT,
    "messagesSentToday" INTEGER NOT NULL DEFAULT 0,
    "waveMessagesSent" INTEGER NOT NULL DEFAULT 0,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "rateLimitedAt" TIMESTAMP(3),
    "cooldownUntil" TIMESTAMP(3),
    "lastWaveStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountBlockEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "BlockType" NOT NULL,
    "message" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountBlockEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProspectAccount_airbnbEmail_key" ON "ProspectAccount"("airbnbEmail");
CREATE INDEX "ProspectAccount_status_cooldownUntil_idx" ON "ProspectAccount"("status", "cooldownUntil");
CREATE INDEX "AccountBlockEvent_accountId_occurredAt_idx" ON "AccountBlockEvent"("accountId", "occurredAt");

-- AddForeignKey
ALTER TABLE "AccountBlockEvent" ADD CONSTRAINT "AccountBlockEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ProspectAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
