-- CreateTable
CREATE TABLE "McpCall" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tool" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "ip" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "McpCall_at_idx" ON "McpCall"("at");
