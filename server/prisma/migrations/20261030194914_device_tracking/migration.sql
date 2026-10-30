-- CreateTable
CREATE TABLE "DeviceEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mac" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    "online" BOOLEAN NOT NULL,
    CONSTRAINT "DeviceEvent_mac_fkey" FOREIGN KEY ("mac") REFERENCES "Device" ("mac") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Device" (
    "mac" TEXT NOT NULL PRIMARY KEY,
    "ip" TEXT NOT NULL,
    "vendor" TEXT,
    "hostname" TEXT,
    "name" TEXT,
    "firstSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" DATETIME NOT NULL,
    "known" BOOLEAN NOT NULL DEFAULT false,
    "alertOfflineMinutes" INTEGER,
    "offlineAlerted" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Device" ("firstSeen", "hostname", "ip", "lastSeen", "mac", "name", "vendor") SELECT "firstSeen", "hostname", "ip", "lastSeen", "mac", "name", "vendor" FROM "Device";
DROP TABLE "Device";
ALTER TABLE "new_Device" RENAME TO "Device";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DeviceEvent_mac_at_idx" ON "DeviceEvent"("mac", "at");
