-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('LEAD_DISCOVERED', 'INITIAL_MSG_SENT', 'FOLLOW_UP_1_SENT', 'FOLLOW_UP_2_SENT', 'FOLLOW_UP_3_SENT', 'REPLIED_IN_PROGRESS', 'HUMAN_TAKEOVER', 'CLOSED_WON', 'CLOSED_LOST');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'SYSTEM');

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "hostAirbnbId" TEXT NOT NULL,
    "threadId" TEXT,
    "name" TEXT NOT NULL,
    "hostProfileUrl" TEXT NOT NULL,
    "primaryListingUrl" TEXT NOT NULL,
    "primaryListingName" TEXT,
    "totalProperties" INTEGER NOT NULL DEFAULT 1,
    "companyName" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'LEAD_DISCOVERED',
    "businessScale" TEXT,
    "painPoints" TEXT,
    "executiveSummary" TEXT,
    "lastContactedAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "botReplyCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "content" TEXT NOT NULL,
    "aiIntent" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemState" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemState_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_hostAirbnbId_key" ON "Lead"("hostAirbnbId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_threadId_key" ON "Lead"("threadId");

-- CreateIndex
CREATE INDEX "Lead_status_nextFollowUpAt_idx" ON "Lead"("status", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "Message_leadId_sentAt_idx" ON "Message"("leadId", "sentAt");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
