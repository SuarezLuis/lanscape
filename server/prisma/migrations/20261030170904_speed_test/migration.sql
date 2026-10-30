-- CreateTable
CREATE TABLE "SpeedTest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "downloadMbps" REAL NOT NULL,
    "uploadMbps" REAL NOT NULL,
    "pingMs" REAL NOT NULL,
    "jitterMs" REAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "serverName" TEXT NOT NULL,
    "serverSponsor" TEXT NOT NULL,
    "serverDistanceKm" REAL NOT NULL
);
