"use client";

import Link from "next/link";

interface Skill {
  name: string;
  color: string;
}

const defaultSkills: Skill[] = [
  { name: "React", color: "#61dafb" },
  { name: "TypeScript", color: "#3178c6" },
  { name: "Next.js", color: "#000000" },
  { name: "PostgreSQL", color: "#4169e1" },
  { name: "Python", color: "#3776ab" },
  { name: "Docker", color: "#2496ed" },
  { name: "Go", color: "#00add8" },
  { name: "Redis", color: "#dc382d" },
];

export default function SkillsGrid() {
  return (
    <div className="card h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
          技能 &amp; 工具
        </h3>
        <Link
          href="/about"
          className="flex items-center gap-1 text-xs transition-colors"
          style={{ color: "var(--text-3)" }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.color = "var(--text-1)";
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.color = "var(--text-3)";
          }}
        >
          全部
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>

      {/* Skills grid */}
      <div className="grid grid-cols-4 gap-2 flex-1 content-center">
        {defaultSkills.map((skill) => (
          <div
            key={skill.name}
            className="skill-item flex flex-col items-center justify-center p-3 rounded-xl transition-all duration-300 cursor-default"
            style={{
              border: "1px solid var(--border)",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              el.style.transform = "translateY(-3px)";
              el.style.borderColor = "rgba(99,102,241,0.3)";
              el.style.boxShadow = "0 4px 15px rgba(99,102,241,0.08)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget;
              el.style.transform = "translateY(0)";
              el.style.borderColor = "var(--border)";
              el.style.boxShadow = "none";
            }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold mb-2"
              style={{
                background: `${skill.color}18`,
                color: skill.color,
              }}
            >
              {skill.name.slice(0, 2).toUpperCase()}
            </div>
            <span
              className="text-xs font-medium"
              style={{ color: "var(--text-2)" }}
            >
              {skill.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
