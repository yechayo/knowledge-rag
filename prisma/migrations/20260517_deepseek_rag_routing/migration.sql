ALTER TABLE "UsageLog" ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "AgentModelConfig" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "modelName" TEXT NOT NULL,
  "baseURL" TEXT NOT NULL,
  "apiKey" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgentModelConfig_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentModelConfig_isDefault_idx" ON "AgentModelConfig"("isDefault");
