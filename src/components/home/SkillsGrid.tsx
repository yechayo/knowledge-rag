"use client";

interface Skill {
  name: string;
  icon: string;
  bg: string;
  url: string;
}

const row1: Skill[] = [
  { name: "React", icon: "react", bg: "#20232A", url: "https://react.dev" },
  { name: "TypeScript", icon: "typescript", bg: "#3178C6", url: "https://www.typescriptlang.org" },
  { name: "Next.js", icon: "nextdotjs", bg: "#171717", url: "https://nextjs.org" },
  { name: "OpenAI", icon: "openai", bg: "#412991", url: "https://openai.com" },
  { name: "Python", icon: "python", bg: "#3776AB", url: "https://www.python.org" },
  { name: "Docker", icon: "docker", bg: "#2496ED", url: "https://www.docker.com" },
  { name: "智谱AI", icon: "zhipuai", bg: "#3E6BF0", url: "https://open.bigmodel.cn" },
  { name: "Tailwind", icon: "tailwindcss", bg: "#06B6D4", url: "https://tailwindcss.com" },
];

const row2: Skill[] = [
  { name: "Go", icon: "go", bg: "#00ADD8", url: "https://go.dev" },
  { name: "Redis", icon: "redis", bg: "#DC382D", url: "https://redis.io" },
  { name: "Node.js", icon: "nodedotjs", bg: "#339933", url: "https://nodejs.org" },
  { name: "PostgreSQL", icon: "postgresql", bg: "#336791", url: "https://www.postgresql.org" },
  { name: "Git", icon: "git", bg: "#F05032", url: "https://git-scm.com" },
  { name: "Flock", icon: "flock", bg: "#6C3FC5", url: "https://flock.io" },
  { name: "Linux", icon: "linux", bg: "#FCC624", url: "https://www.kernel.org" },
  { name: "Vercel", icon: "vercel", bg: "#171717", url: "https://vercel.com" },
];

const TEXT_ONLY = new Set(["openai", "zhipuai", "flock"]);

function SkillRow({ skills, offset }: { skills: Skill[]; offset: boolean }) {
  const items = [...skills, ...skills];
  return (
    <div className="skill-scroll-track">
      <div className={`skill-scroll-inner ${offset ? "skill-scroll-offset" : ""}`}>
        {items.map((skill, i) => (
          <a
            key={`${skill.icon}-${i}`}
            href={skill.url}
            target="_blank"
            rel="noopener noreferrer"
            className="skill-scroll-item"
            title={skill.name}
            style={{ background: skill.bg }}
          >
            {TEXT_ONLY.has(skill.icon) ? (
              <span className="text-white text-xs font-bold">
                {skill.name.length <= 2 ? skill.name.toUpperCase() : skill.name.slice(0, 2).toUpperCase()}
              </span>
            ) : (
              <img
                src={`https://cdn.simpleicons.org/${skill.icon}/fff`}
                alt={skill.name}
                className="w-7 h-7"
                loading="lazy"
              />
            )}
          </a>
        ))}
      </div>
    </div>
  );
}

export default function SkillsGrid() {
  return (
    <div className="card h-full flex flex-col" style={{ overflow: "hidden" }}>
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
          技能 &amp; 工具
        </h3>
      </div>
      <div className="flex-1 flex flex-col justify-center gap-2 min-w-0">
        <SkillRow skills={row1} offset={false} />
        <SkillRow skills={row2} offset={true} />
      </div>
    </div>
  );
}
