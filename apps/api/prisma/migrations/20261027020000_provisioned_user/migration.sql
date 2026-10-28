-- Администратор и seed могут заранее создать профиль по Telegram ID.
-- Телефон появляется только после request_contact; вручную он не назначается.
ALTER TABLE "users" DROP CONSTRAINT "users_identity_check";
ALTER TABLE "users" ADD CONSTRAINT "users_identity_check" CHECK (
  ("anonymizedAt" IS NULL AND "telegramId" IS NOT NULL)
  OR ("anonymizedAt" IS NOT NULL AND "telegramId" IS NULL AND "chatId" IS NULL
    AND "phone" IS NULL AND "email" IS NULL AND "birthDate" IS NULL
    AND "telegramUsername" IS NULL AND "nickname" IS NULL AND "avatarUrl" IS NULL
    AND "city" IS NULL AND "fullName" = 'Удаленный пользователь')
);
