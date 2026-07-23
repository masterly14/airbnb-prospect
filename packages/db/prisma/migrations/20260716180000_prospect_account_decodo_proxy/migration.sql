-- AlterTable: metadata de proxy Decodo (sticky session por cuenta)
ALTER TABLE "ProspectAccount" ADD COLUMN "proxyProvider" TEXT;
ALTER TABLE "ProspectAccount" ADD COLUMN "proxySessionId" TEXT;
ALTER TABLE "ProspectAccount" ADD COLUMN "proxyCountry" TEXT;
