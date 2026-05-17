"use client";

import ProfileWidget from "./ProfileWidget";
import TocWidget from "./TocWidget";
import LinksWidget from "./LinksWidget";
import AnimatedWrapper from "@/components/ui/AnimatedWrapper";

interface SidebarProps {
  body: string;
  category: string;
  currentSlug: string;
}

export default function Sidebar({ body, category, currentSlug }: SidebarProps) {
  return (
    <aside
      className="hidden lg:block flex-shrink-0 overflow-y-auto sidebar-no-scrollbar"
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
        <AnimatedWrapper index={0}>
          <div
            className="rounded-[24px] p-4"
            style={{
              background: "var(--card)",
              border: "3px solid var(--border)",
              boxShadow: "0 6px 0 rgba(189,174,160,0.78)",
            }}
          >
            <ProfileWidget />
          </div>
        </AnimatedWrapper>

        {/* TOC */}
        <AnimatedWrapper index={1}>
          <div
            className="rounded-[24px] p-4"
            style={{
              background: "var(--card)",
              border: "3px solid var(--border)",
              boxShadow: "0 6px 0 rgba(189,174,160,0.78)",
            }}
          >
            <TocWidget body={body} />
          </div>
        </AnimatedWrapper>

        {/* Links */}
        <AnimatedWrapper index={2}>
          <div
            className="rounded-[24px] p-4"
            style={{
              background: "var(--card)",
              border: "3px solid var(--border)",
              boxShadow: "0 6px 0 rgba(189,174,160,0.78)",
            }}
          >
            <LinksWidget category={category} currentSlug={currentSlug} />
          </div>
        </AnimatedWrapper>
      </div>
    </aside>
  );
}
