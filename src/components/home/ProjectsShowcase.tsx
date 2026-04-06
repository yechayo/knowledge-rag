"use client";

import { useEffect, useState } from "react";

interface Project {
  id: string;
  title: string;
  icon: string;
  description?: string;
  href: string;
  viewCount: number;
}

export default function ProjectsShowcase() {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    fetch("/api/content?category=project&status=published&limit=3")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.items) && data.items.length > 0) {
          setProjects(
            data.items.map((item: Record<string, unknown>) => {
              const title = (item.title as string) || "项目";
              return {
                id: item.id as string,
                title,
                icon: title.slice(0, 2).toUpperCase(),
                description: ((item.metadata as Record<string, unknown>)?.description as string) || "",
                href: `/project/${item.slug as string}`,
                viewCount: (item.viewCount as number) || 0,
              };
            })
          );
        }
      })
      .catch(() => {});
  }, []);

  const rotations = [-3, 2, -2];

  if (projects.length === 0) return null;

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
              {project.title}
            </span>
            {project.description && (
              <span
                className="text-xs text-center mt-1 line-clamp-2"
                style={{ color: "var(--text-3)" }}
              >
                {project.description}
              </span>
            )}
            <span className="text-xs mt-2" style={{ color: "var(--text-3)" }}>
              {project.viewCount} 次浏览
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
