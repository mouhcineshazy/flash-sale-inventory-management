-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'CAD',
ADD COLUMN     "priceAmount" INTEGER NOT NULL DEFAULT 0;
