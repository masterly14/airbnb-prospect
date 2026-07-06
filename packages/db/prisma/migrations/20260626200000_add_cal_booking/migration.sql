-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "calBookedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CalBooking" (
    "id" TEXT NOT NULL,
    "calUid" TEXT NOT NULL,
    "calBookingId" INTEGER,
    "leadId" TEXT NOT NULL,
    "triggerEvent" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "attendeeEmail" TEXT,
    "attendeeName" TEXT,
    "eventTypeSlug" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalBooking_calUid_key" ON "CalBooking"("calUid");

-- CreateIndex
CREATE INDEX "CalBooking_leadId_idx" ON "CalBooking"("leadId");

-- AddForeignKey
ALTER TABLE "CalBooking" ADD CONSTRAINT "CalBooking_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
