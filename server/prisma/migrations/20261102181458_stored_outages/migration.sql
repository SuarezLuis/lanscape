-- CreateTable
CREATE TABLE "Outage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "start" DATETIME NOT NULL,
    "end" DATETIME NOT NULL,
    "failedChecks" INTEGER NOT NULL,
    "cause" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "Outage_start_idx" ON "Outage"("start");
