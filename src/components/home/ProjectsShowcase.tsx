"use client";

import { useEffect, useState } from "react";

interface Project {
  id: string;
  name: string;
  icon: string;
  description?: string;
  href?: string;
}

const defaultProjects: Project[] = [
  {
    id: "1",
    name: "KnowledgeRag",
    icon: "KR",
    description: "个人知识管理与 RAG 问答平台",
    href: "/project",
  },
  {
    id: "2",
    name: "Blog Engine",
    icon: "BE",
    description: "基于 Next.js 的博客引擎",
    href: "/project",
  },
  {
    id: "3",
    name: "Dev Toolkit",
    icon: "DT",
    description: "开发者工具集合",
    href: "/project",
  },
];

export default function ProjectsShowcase() {
  const [projects, setProjects] = useState<Project[]>(defaultProjects);

  useEffect(() => {
    fetch("/api/content?category=project&status=published")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setProjects(
            data.slice(0, 3).map((item: Record<string, string>) => ({
              id: item.id,
              name: item.title || item.name,
              icon: (item.title || item.name || "P").slice(0, 2).toUpperCase(),
              description: item.description,
              href: "/project",
            }))
          );
        }
      })
      .catch(() => {
        // Use defaults
      });
  }, []);

  const rotations = [-3, 2, -2];

  return (
    <div className="card h-full flex items-center justify-center p-6">
      <div className="flex items-center justify-center gap-5 w-full">
        {projects.map((project, i) => (
          <a
            key={project.id}
            href={project.href}
            className="project-tilted flex-1 max-w-[200px] flex flex-col items-center justify-center p-5 rounded-xl transition-all duration-300 group"
            style={{
              background: "var(--accent-bg)",
              border: "1px solid var(--border)",
              transform: `rotate(${rotations[i]}deg)`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "rotate(0deg) translateY(-6px) scale(1.03)";
              e.currentTarget.style.borderColor = "rgba(99,102,241,0.3)";
              e.currentTarget.style.boxShadow = "0 8px 30px rgba(99,102,241,0.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = `rotate(${rotations[i]}deg)`;
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-sm font-bold mb-3 transition-colors duration-300"
              style={{
                background: "var(--accent)",
                color: "white",
              }}
            >
              {project.icon}
            </div>
            <span
              className="text-sm font-semibold text-center"
              style={{ color: "var(--text-1)" }}
            >
              {project.name}
            </span>
            {project.description && (
              <span
                className="text-xs text-center mt-1 line-clamp-2"
                style={{ color: "var(--text-3)" }}
              >
                {project.description}
              </span>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
