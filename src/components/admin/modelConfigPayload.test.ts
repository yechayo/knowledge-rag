import { describe, expect, it } from "vitest";
import { buildModelConfigSavePayload } from "./modelConfigPayload";

describe("buildModelConfigSavePayload", () => {
  it("omits apiKey when updating an existing config without a replacement key", () => {
    expect(buildModelConfigSavePayload({
      name: "DeepSeek",
      modelName: "deepseek-v4-flash",
      baseURL: "https://api.deepseek.com",
      apiKey: "",
      isEditing: true,
    })).toEqual({
      name: "DeepSeek",
      modelName: "deepseek-v4-flash",
      baseURL: "https://api.deepseek.com",
    });
  });

  it("includes apiKey for new configs and edited configs with a replacement key", () => {
    expect(buildModelConfigSavePayload({
      name: "DeepSeek",
      modelName: "deepseek-v4-flash",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-new",
      isEditing: false,
    })).toEqual({
      name: "DeepSeek",
      modelName: "deepseek-v4-flash",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-new",
    });

    expect(buildModelConfigSavePayload({
      name: "DeepSeek",
      modelName: "deepseek-v4-flash",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-replacement",
      isEditing: true,
    })).toEqual(expect.objectContaining({ apiKey: "sk-replacement" }));
  });
});
