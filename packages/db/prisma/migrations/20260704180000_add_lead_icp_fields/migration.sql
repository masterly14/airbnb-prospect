-- CreateEnum
CREATE TYPE "IcpSkipReason" AS ENUM ('below_min', 'above_max', 'not_superhost', 'hotel_loft', 'wrong_market');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "isSuperhost" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lead" ADD COLUMN "market" TEXT;
ALTER TABLE "Lead" ADD COLUMN "icpSkipReason" "IcpSkipReason";
