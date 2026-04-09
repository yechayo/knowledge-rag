/**
 * 文本格式工具调用检测器
 * 当模型不支持结构化 tool calling 时，从 AI 文本输出中检测工具调用
 *
 * 支持两种模式：
 * 1. 前缀模式：文本以工具名开头（如 "create_content\n{...}"）
 * 2. 内嵌模式：工具名出现在文本中间（如 "我先帮你查看。create_content\n{...}"）
 */

export interface TextToolCallResult {
  toolName: string;
  args: Record<string, unknown>;
  tool: unknown;
  prefix: string;
}

/**
 * 检测 AI 消息中的文本格式工具调用
 */
export function detectTextToolCall(
  text: string,
  tools: unknown[],
): TextToolCallResult | null {
  // 先尝试前缀模式（更精确，优先匹配）
  const prefixResult = detectPrefixToolCall(text, tools);
  if (prefixResult) return prefixResult;

  // 再尝试内嵌模式（从文本中搜索 tool_name\n{ 的模式）
  return detectEmbeddedToolCall(text, tools);
}

/**
 * 前缀模式：文本以工具名开头
 */
function detectPrefixToolCall(
  text: string,
  tools: unknown[],
): TextToolCallResult | null {
  const toolNames = tools.map((t: any) => t.name);
  const sortedNames = [...toolNames].sort((a, b) => b.length - a.length);
  const trimmed = text.trimStart();
  const leadingWs = text.length - trimmed.length;

  for (const name of sortedNames) {
    if (!trimmed.startsWith(name)) continue;
    if (trimmed.length > name.length) {
      const next = trimmed[name.length];
      if (next !== ' ' && next !== '\t' && next !== '\n' && next !== '\r' && !(next === '\\' && trimmed[name.length + 1] === 'n')) {
        continue;
      }
    }

    let idx = name.length;
    while (idx < trimmed.length) {
      const c = trimmed[idx];
      if (c === '{') break;
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { idx++; continue; }
      if (c === '\\' && idx + 1 < trimmed.length && trimmed[idx + 1] === 'n') { idx += 2; continue; }
      break;
    }
    if (idx >= trimmed.length || trimmed[idx] !== '{') continue;

    const jsonPart = trimmed.substring(idx);
    const tool = tools.find((t: any) => t.name === name);

    const args = tryParseToolArgs(jsonPart);
    if (args !== null) {
      return { toolName: name, args, tool, prefix: text.substring(0, leadingWs) };
    }
  }
  return null;
}

/**
 * 内嵌模式：从文本中搜索 `tool_name\n{` 模式
 * 用于处理模型先输出自然语言，再在中间插入工具调用的情况
 */
function detectEmbeddedToolCall(
  text: string,
  tools: unknown[],
): TextToolCallResult | null {
  const toolNames = tools.map((t: any) => t.name);
  // 按名称长度降序匹配，避免短名称错误匹配
  const sortedNames = [...toolNames].sort((a, b) => b.length - a.length);

  for (const name of sortedNames) {
    // 搜索 "name\n{" 或 "name {" 的模式
    const patterns = [
      `\n${name}\n{`,
      `\n${name} {`,
      `\n${name}\n`,
    ];

    for (const pattern of patterns) {
      const idx = text.indexOf(pattern);
      if (idx === -1) continue;

      const prefix = text.substring(0, idx);
      const jsonPart = text.substring(idx + pattern.indexOf('{'));
      const tool = tools.find((t: any) => t.name === name);

      const args = tryParseToolArgs(jsonPart);
      if (args !== null) {
        return { toolName: name, args, tool, prefix };
      }
    }
  }
  return null;
}

/**
 * 尝试解析工具参数 JSON，支持完整解析和截断解析
 */
function tryParseToolArgs(jsonPart: string): Record<string, unknown> | null {
  // 尝试完整解析
  try {
    const args = JSON.parse(jsonPart);
    if (typeof args === "object" && args !== null && !Array.isArray(args)) {
      return args;
    }
  } catch { /* ignore */ }

  // 截断解析：找到最外层的闭合 } 对应的 JSON
  const last = jsonPart.lastIndexOf('}');
  if (last > 0) {
    try {
      const args = JSON.parse(jsonPart.substring(0, last + 1));
      if (typeof args === "object" && args !== null && !Array.isArray(args)) {
        return args;
      }
    } catch { /* ignore */ }
  }

  // 花括号匹配：找到工具参数对象的起止位置
  const braceStart = jsonPart.indexOf('{');
  if (braceStart === -1) return null;

  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < jsonPart.length; i++) {
    if (jsonPart[i] === '{') depth++;
    else if (jsonPart[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;

  try {
    const args = JSON.parse(jsonPart.substring(0, end + 1));
    if (typeof args === "object" && args !== null && !Array.isArray(args)) {
      return args;
    }
  } catch { /* ignore */ }

  return null;
}
