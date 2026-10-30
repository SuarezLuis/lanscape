-- CreateTable
CREATE TABLE "Automation" (
    "job" TEXT NOT NULL PRIMARY KEY,
    "everyMinutes" INTEGER,
    "offsetMinutes" INTEGER NOT NULL DEFAULT 0,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "target" TEXT
);

-- CreateTable
CREATE TABLE "PingSample" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "target" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "sent" INTEGER NOT NULL,
    "received" INTEGER NOT NULL,
    "avgMs" REAL,
    "jitterMs" REAL
);

-- CreateIndex
CREATE INDEX "PingSample_createdAt_idx" ON "PingSample"("createdAt");
