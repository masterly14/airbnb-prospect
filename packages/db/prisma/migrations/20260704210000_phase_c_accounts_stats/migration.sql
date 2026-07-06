-- AlterTable ProspectAccount
ALTER TABLE "ProspectAccount" ADD COLUMN "airbnbPasswordEnc" TEXT;
ALTER TABLE "ProspectAccount" RENAME COLUMN "proxyPass" TO "proxyPassEnc";

-- AlterTable Message
ALTER TABLE "Message" ADD COLUMN "prospectAccountId" TEXT;
CREATE INDEX "Message_prospectAccountId_idx" ON "Message"("prospectAccountId");
ALTER TABLE "Message" ADD CONSTRAINT "Message_prospectAccountId_fkey" FOREIGN KEY ("prospectAccountId") REFERENCES "ProspectAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable DailyOutboundStats
CREATE TABLE "DailyOutboundStats" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "market" TEXT NOT NULL,
    "coldMessagesSent" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyOutboundStats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyOutboundStats_date_market_key" ON "DailyOutboundStats"("date", "market");
CREATE INDEX "DailyOutboundStats_date_idx" ON "DailyOutboundStats"("date");
