-- CreateTable
CREATE TABLE "ServiceCheck" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "query" TEXT,
    "everyMinutes" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "alert" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "failingSince" DATETIME,
    "alerted" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "ServiceResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "checkId" INTEGER NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "ms" REAL,
    "detail" TEXT,
    CONSTRAINT "ServiceResult_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "ServiceCheck" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ServiceResult_checkId_at_idx" ON "ServiceResult"("checkId", "at");
