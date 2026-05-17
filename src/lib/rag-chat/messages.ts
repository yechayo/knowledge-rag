import { AIMessage, BaseMessage, HumanMessage, trimMessages } from "@langchain/core/messages";

export interface PersistedChatMessage {
  role: string;
  content: unknown;
}

export async function buildInputMessagesFromHistory(
  history: PersistedChatMessage[],
  latestUserQuery: string,
  maxTokens: number,
): Promise<BaseMessage[]> {
  const messages = history.map((message) => {
    const content = typeof message.content === "string" ? message.content : String(message.content || "");
    return message.role === "assistant" ? new AIMessage(content) : new HumanMessage(content);
  });

  const last = messages[messages.length - 1];
  const lastContent = typeof last?.content === "string" ? last.content : "";
  if (!(last instanceof HumanMessage) || lastContent !== latestUserQuery) {
    messages.push(new HumanMessage(latestUserQuery));
  }

  return trimMessages(messages, {
    maxTokens,
    strategy: "last",
    includeSystem: true,
    startOn: "human",
    allowPartial: true,
    tokenCounter: countTokens,
  });
}

function countTokens(msgs: BaseMessage[]): number {
  return msgs.reduce((total, msg) => {
    const text = typeof msg.content === "string" ? msg.content : String(msg.content || "");
    const cn = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const en = text.replace(/[\u4e00-\u9fff]/g, " ").split(/\s+/).filter((word: string) => word.length > 0).length;
    return total + Math.ceil(cn * 2 + en * 1.3) + 4;
  }, 0);
}
