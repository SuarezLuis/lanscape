-- CreateTable
CREATE TABLE "NotificationRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "metric" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "sustainMinutes" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "pendingSince" DATETIME,
    "alerting" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ruleId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "baseline" REAL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Notification_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "NotificationRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- Starter rules, off until the user turns them on
INSERT INTO "NotificationRule" ("metric", "direction", "mode", "value", "sustainMinutes") VALUES
  ('download', 'below', 'percent', 50, 0),
  ('internetLoss', 'above', 'fixed', 5, 5),
  ('routerPing', 'above', 'fixed', 20, 5);
