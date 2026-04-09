export interface SkillContext {
  activeSkill: string | null;
  skillPrompt: string | null;
  cleanMessage?: string;
}

const SKILL_COMMAND_REGEX = /^\/(\w+)(?:\s+(.*))?$/;

export interface SkillCommand {
  skill: string;
  cleanMessage: string;
}

/**
 * 从用户消息中提取斜杠命令
 * 返回 { skill, cleanMessage } 或 null
 */
export function extractSkillCommand(message: string): SkillCommand | null {
  const trimmed = message.trim();
  const match = trimmed.match(SKILL_COMMAND_REGEX);
  if (!match) return null;

  return {
    skill: match[1].toLowerCase(),
    cleanMessage: match[2]?.trim() || "",
  };
}

/**
 * 解析请求中的 skill 参数
 * 支持两种方式:
 * 1. explicitSkill 显式指定（如 body.skill === 'brainstorming'）
 * 2. 从用户消息中提取 /skill-name 命令
 */
export function resolveSkillContext(
  message: string,
  explicitSkill?: string | null
): SkillContext {
  // 优先使用显式指定的 skill
  if (explicitSkill && typeof explicitSkill === "string" && explicitSkill.trim()) {
    return {
      activeSkill: explicitSkill.trim().toLowerCase(),
      skillPrompt: null, // 由调用方通过 getSkillPrompt 获取
    };
  }

  // 从消息中提取斜杠命令
  const cmd = extractSkillCommand(message);
  if (cmd) {
    return {
      activeSkill: cmd.skill,
      cleanMessage: cmd.cleanMessage,
      skillPrompt: null,
    };
  }

  return {
    activeSkill: null,
    skillPrompt: null,
  };
}

