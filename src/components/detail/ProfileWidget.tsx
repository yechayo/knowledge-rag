"use client";

import { useEffect, useState } from "react";

interface SiteConfig {
  siteName?: string;
  siteBio?: string;
  siteOwner?: string;
}

interface Stats {
  articles: number;
  tags: number;
  days: number;
}

export default function ProfileWidget() {
  const [config, setConfig] = useState<SiteConfig>({});
  const [stats, setStats] = useState<Stats>({ articles: 0, tags: 0, days: 0 });

  useEffect(() => {
    async function fetchData() {
      try {
        const [configRes, contentRes] = await Promise.all([
          fetch("/api/config"),
          fetch("/api/content?limit=100"),
        ]);

        if (configRes.ok) {
          const data = await configRes.json();
          setConfig(data);
        }

        if (contentRes.ok) {
          const data = await contentRes.json();
          const items = data.items || [];

          // 统计文章数
          const articles = items.length;

          // 统计标签数（从 metadata.tags 中提取）
          const tagSet = new Set<string>();
          items.forEach((item: any) => {
            const tags = item.metadata?.tags;
            if (Array.isArray(tags)) {
              tags.forEach((t: string) => tagSet.add(t));
            }
          });

          // 计算运行天数（取最早文章的创建时间）
          let days = 0;
          if (items.length > 0) {
            const earliest = new Date(
              items[items.length - 1].createdAt
            ).getTime();
            days = Math.max(
              1,
              Math.ceil((Date.now() - earliest) / (1000 * 60 * 60 * 24))
            );
          }

          setStats({ articles, tags: tagSet.size, days });
        }
      } catch {
        // 使用默认值
      }
    }

    fetchData();
  }, []);

  const name = config.siteOwner || config.siteName || "yechayo";
  const bio = config.siteBio || "个人知识库";
  const initial = name.charAt(0).toUpperCase();

  return (
    <div className="text-center">
      {/* Avatar */}
      <div className="flex justify-center mb-3">
        <div className="avatar-ring">
          <div className="avatar-letter">{initial}</div>
        </div>
      </div>

      {/* Name */}
      <h3
        className="text-base font-bold mb-1"
        style={{ color: "var(--text-1)" }}
      >
        {name}
      </h3>

      {/* Bio */}
      <p className="text-xs mb-4" style={{ color: "var(--text-2)" }}>
        {bio}
      </p>

      {/* Stats */}
      <div
        className="flex justify-around text-center py-3 rounded-lg"
        style={{
          background: "var(--card-hover)",
          border: "1px solid var(--border)",
        }}
      >
        <div>
          <div className="text-lg font-bold" style={{ color: "var(--text-1)" }}>
            {stats.articles}
          </div>
          <div className="text-xs" style={{ color: "var(--text-3)" }}>
            文章
          </div>
        </div>
        <div>
          <div className="text-lg font-bold" style={{ color: "var(--text-1)" }}>
            {stats.tags}
          </div>
          <div className="text-xs" style={{ color: "var(--text-3)" }}>
            标签
          </div>
        </div>
        <div>
          <div className="text-lg font-bold" style={{ color: "var(--text-1)" }}>
            {stats.days}
          </div>
          <div className="text-xs" style={{ color: "var(--text-3)" }}>
            天
          </div>
        </div>
      </div>
    </div>
  );
}
