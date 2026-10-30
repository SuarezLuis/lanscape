-- CreateTable
CREATE TABLE "Device" (
    "mac" TEXT NOT NULL PRIMARY KEY,
    "ip" TEXT NOT NULL,
    "vendor" TEXT,
    "hostname" TEXT,
    "name" TEXT,
    "firstSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Notification" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ruleId" INTEGER,
    "kind" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "baseline" REAL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Notification_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "NotificationRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Notification" ("baseline", "createdAt", "id", "kind", "message", "read", "ruleId", "value") SELECT "baseline", "createdAt", "id", "kind", "message", "read", "ruleId", "value" FROM "Notification";
DROP TABLE "Notification";
ALTER TABLE "new_Notification" RENAME TO "Notification";
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
