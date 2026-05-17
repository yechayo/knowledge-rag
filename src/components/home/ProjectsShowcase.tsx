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
  const [loaded, setLoaded] = useState(false);

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
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const rotations = [-3, 2, -2];
  const colors = ["var(--island-teal)", "var(--island-blue)", "var(--island-orange)"];
  const shadows = ["var(--island-teal-deep)", "#6677c8", "#c46f47"];

  // 加载完成后，如果没有项目也不隐藏卡片，保持占位
  return (
    <div className="card h-full flex items-center justify-center p-6">
      {projects.length > 0 ? (
        <div className="flex items-center justify-center gap-5 w-full max-[640px]:flex-col">
          {projects.map((project, i) => (
            <a
              key={project.id}
              href={project.href}
              className="project-tilted flex-1 max-w-[200px] min-h-[154px] flex flex-col items-center justify-center p-5 rounded-[28px] transition-all duration-300 group max-[640px]:max-w-full max-[640px]:w-full"
              style={{
                background: colors[i % colors.length],
                border: "2px solid rgba(255,255,255,0.45)",
                boxShadow: `0 6px 0 ${shadows[i % shadows.length]}`,
                transform: `rotate(${rotations[i]}deg)`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "rotate(0deg) translateY(-6px) scale(1.03)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.75)";
                e.currentTarget.style.boxShadow = `0 10px 0 ${shadows[i % shadows.length]}, 0 18px 32px rgba(61,52,40,0.16)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = `rotate(${rotations[i]}deg)`;
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.45)";
                e.currentTarget.style.boxShadow = `0 6px 0 ${shadows[i % shadows.length]}`;
              }}
            >
              <div
                className="w-14 h-14 rounded-[20px] flex items-center justify-center text-sm font-black mb-3 transition-colors duration-300"
                style={{
                  background: "rgba(255,255,255,0.24)",
                  border: "2px solid rgba(255,255,255,0.45)",
                  color: "white",
                }}
              >
                {project.icon}
              </div>
              <span
                className="text-sm font-black text-center"
                style={{ color: "white" }}
              >
                {project.title}
              </span>
              {project.description && (
                <span
                  className="text-xs text-center mt-1 line-clamp-2"
                  style={{ color: "rgba(255,255,255,0.84)" }}
                >
                  {project.description}
                </span>
              )}
              <span className="text-xs mt-2 font-bold" style={{ color: "rgba(255,255,255,0.82)" }}>
                {project.viewCount} 次浏览
              </span>
            </a>
          ))}
        </div>
      ) : loaded ? (
        // 加载完成但没有项目时显示提示
        <span className="text-sm" style={{ color: "var(--text-3)" }}>
          暂无项目
        </span>
      ) : (
        // 加载中显示占位
        <span className="text-sm" style={{ color: "var(--text-3)" }}>
          加载中...
        </span>
      )}
    </div>
  );
}
