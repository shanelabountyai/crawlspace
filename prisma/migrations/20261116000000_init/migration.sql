-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Report" (
    "scanId" TEXT NOT NULL PRIMARY KEY,
    "finalUrl" TEXT NOT NULL,
    "siteType" TEXT NOT NULL,
    "rubricVersion" INTEGER NOT NULL,
    "overall" REAL,
    "scorecard" TEXT NOT NULL,
    "fixList" TEXT NOT NULL,
    "crawl" TEXT NOT NULL,
    CONSTRAINT "Report_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Scan_createdAt_idx" ON "Scan"("createdAt");
