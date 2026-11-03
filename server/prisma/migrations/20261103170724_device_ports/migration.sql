-- AlterTable
ALTER TABLE "Device" ADD COLUMN "portsScannedAt" DATETIME;

-- CreateTable
CREATE TABLE "DevicePort" (
    "mac" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "service" TEXT,
    "detail" TEXT,

    PRIMARY KEY ("mac", "port"),
    CONSTRAINT "DevicePort_mac_fkey" FOREIGN KEY ("mac") REFERENCES "Device" ("mac") ON DELETE CASCADE ON UPDATE CASCADE
);
