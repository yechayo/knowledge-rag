import { describe, expect, it } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import { buildInputMessagesFromHistory } from "./messages";

describe("buildInputMessagesFromHistory", () => {
  it("does not duplicate the latest user query when it is already persisted in history", async () => {
    const messages = await buildInputMessagesFromHistory([
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好，有什么可以帮你？" },
      { role: "user", content: "对比知识库里的两篇文章" },
    ], "对比知识库里的两篇文章", 4000);

    const humanMessages = messages.filter((message) => message instanceof HumanMessage);
    expect(humanMessages.map((message) => message.content)).toEqual([
      "你好",
      "对比知识库里的两篇文章",
    ]);
  });

  it("appends the latest user query when history does not contain it yet", async () => {
    const messages = await buildInputMessagesFromHistory([
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好，有什么可以帮你？" },
    ], "项目经验有哪些？", 4000);

    expect(messages[messages.length - 1]).toBeInstanceOf(HumanMessage);
    expect(messages[messages.length - 1].content).toBe("项目经验有哪些？");
  });
});
