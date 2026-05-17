interface BuildModelConfigSavePayloadInput {
  name: string;
  modelName: string;
  baseURL: string;
  apiKey: string;
  isEditing: boolean;
}

export interface ModelConfigSavePayload {
  name: string;
  modelName: string;
  baseURL: string;
  apiKey?: string;
}

export function buildModelConfigSavePayload(input: BuildModelConfigSavePayloadInput): ModelConfigSavePayload {
  const payload: ModelConfigSavePayload = {
    name: input.name.trim(),
    modelName: input.modelName.trim(),
    baseURL: input.baseURL.trim(),
  };

  const apiKey = input.apiKey.trim();
  if (apiKey || !input.isEditing) payload.apiKey = apiKey;

  return payload;
}
