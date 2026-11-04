-- CreateTable
CREATE TABLE "AiChange" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "undo" TEXT NOT NULL,
    "undoneAt" DATETIME
);

-- CreateIndex
CREATE INDEX "AiChange_at_idx" ON "AiChange"("at");
