CREATE TABLE IF NOT EXISTS "UserProfile" (
  "userId" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "usernameDisplay" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("userId")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserProfile_username_key" ON "UserProfile"("username");
CREATE INDEX IF NOT EXISTS "UserProfile_email_idx" ON "UserProfile"("email");
