-- CreateEnum
CREATE TYPE "ContactSource" AS ENUM ('OUTBOUND', 'MANUAL_SYNC', 'MANUAL_REGISTER', 'AIRBNB_PRESEND_GUARD', 'BACKFILL');

-- CreateTable
CREATE TABLE "HostContact" (
    "id" TEXT NOT NULL,
    "hostAirbnbId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "firstContactedAt" TIMESTAMP(3) NOT NULL,
    "firstContactAccountId" TEXT,
    "source" "ContactSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HostContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadIdentityAlias" (
    "id" TEXT NOT NULL,
    "aliasId" TEXT NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "leadId" TEXT,

    CONSTRAINT "LeadIdentityAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HostContact_hostAirbnbId_key" ON "HostContact"("hostAirbnbId");

-- CreateIndex
CREATE UNIQUE INDEX "HostContact_leadId_key" ON "HostContact"("leadId");

-- CreateIndex
CREATE INDEX "HostContact_firstContactAccountId_idx" ON "HostContact"("firstContactAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadIdentityAlias_aliasId_key" ON "LeadIdentityAlias"("aliasId");

-- CreateIndex
CREATE INDEX "LeadIdentityAlias_canonicalId_idx" ON "LeadIdentityAlias"("canonicalId");

-- AddForeignKey
ALTER TABLE "HostContact" ADD CONSTRAINT "HostContact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostContact" ADD CONSTRAINT "HostContact_firstContactAccountId_fkey" FOREIGN KEY ("firstContactAccountId") REFERENCES "ProspectAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
