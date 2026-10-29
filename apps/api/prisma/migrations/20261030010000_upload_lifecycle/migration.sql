ALTER TABLE "upload_assets"
  ADD COLUMN "completedAt" TIMESTAMPTZ(3),
  ADD COLUMN "orphanedAt" TIMESTAMPTZ(3),
  ADD COLUMN "checkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "deletionReason" VARCHAR(40);
-- Conservatively treat existing assets as completed; their grace starts at first orphan scan.
UPDATE "upload_assets" SET "completedAt" = "createdAt";
CREATE INDEX "upload_assets_deletedAt_checkedAt_id_idx" ON "upload_assets" ("deletedAt", "checkedAt", "id");
