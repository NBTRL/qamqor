-- Existing meetings remain active. Cancellation metadata is retained with the meeting.
ALTER TABLE "events" ADD COLUMN "cancelledAt" TIMESTAMPTZ(3), ADD COLUMN "cancelReason" VARCHAR(2000);
ALTER TABLE "open_day_sessions" ADD COLUMN "cancelledAt" TIMESTAMPTZ(3), ADD COLUMN "cancelReason" VARCHAR(2000);
ALTER TABLE "events" ADD CONSTRAINT "events_cancellation_check" CHECK (
  ("cancelledAt" IS NULL AND "cancelReason" IS NULL) OR
  ("cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL AND length(btrim("cancelReason")) > 0)
);
ALTER TABLE "open_day_sessions" ADD CONSTRAINT "open_day_sessions_cancellation_check" CHECK (
  ("cancelledAt" IS NULL AND "cancelReason" IS NULL) OR
  ("cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL AND length(btrim("cancelReason")) > 0)
);
