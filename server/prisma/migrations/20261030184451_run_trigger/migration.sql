-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PingSample" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "target" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "sent" INTEGER NOT NULL,
    "received" INTEGER NOT NULL,
    "avgMs" REAL,
    "jitterMs" REAL,
    "trigger" TEXT NOT NULL DEFAULT 'automation'
);
INSERT INTO "new_PingSample" ("avgMs", "createdAt", "host", "id", "jitterMs", "received", "sent", "target") SELECT "avgMs", "createdAt", "host", "id", "jitterMs", "received", "sent", "target" FROM "PingSample";
DROP TABLE "PingSample";
ALTER TABLE "new_PingSample" RENAME TO "PingSample";
CREATE INDEX "PingSample_createdAt_idx" ON "PingSample"("createdAt");
CREATE TABLE "new_SpeedTest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "downloadMbps" REAL NOT NULL,
    "uploadMbps" REAL NOT NULL,
    "pingMs" REAL NOT NULL,
    "jitterMs" REAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "serverName" TEXT NOT NULL,
    "serverSponsor" TEXT NOT NULL,
    "serverDistanceKm" REAL NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'manual'
);
INSERT INTO "new_SpeedTest" ("createdAt", "downloadMbps", "id", "jitterMs", "pingMs", "serverDistanceKm", "serverId", "serverName", "serverSponsor", "uploadMbps") SELECT "createdAt", "downloadMbps", "id", "jitterMs", "pingMs", "serverDistanceKm", "serverId", "serverName", "serverSponsor", "uploadMbps" FROM "SpeedTest";
DROP TABLE "SpeedTest";
ALTER TABLE "new_SpeedTest" RENAME TO "SpeedTest";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
