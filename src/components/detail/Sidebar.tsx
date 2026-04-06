"use client";

import ProfileWidget from "./ProfileWidget";
import TocWidget from "./TocWidget";
import LinksWidget from "./LinksWidget";

interface SidebarProps {
  body: string;
  category: string;
  currentSlug: string;
}

export default function Sidebar({ body, category, currentSlug }: SidebarProps) {
  return (
    <aside
      className="hidden lg:block flex-shrink-0 overflow-y-auto"
      style={{
        width: "260px",
        position: "sticky",
        top: "72px",
        height: "calc(100vh - 72px)",
        paddingBottom: "2rem",
      }}
    >
      <div className="space-y-6">
        {/* Profile */}
        <div
          className="rounded-xl p-4"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          <ProfileWidget />
        </div>

        {/* TOC */}
        <div
          className="rounded-xl p-4"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          <TocWidget body={body} />
        </div>

        {/* Links */}
        <div
          className="rounded-xl p-4"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          <LinksWidget category={category} currentSlug={currentSlug} />
        </div>
      </div>
    </aside>
  );
}
