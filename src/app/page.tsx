"use client";

import { useEffect, useRef, useState } from "react";
import TopNav from "@/components/layout/TopNav";
import ProfileCard from "@/components/home/ProfileCard";
import ProjectsShowcase from "@/components/home/ProjectsShowcase";
import SkillsGrid from "@/components/home/SkillsGrid";
import SloganCard from "@/components/home/SloganCard";
import StatsCard from "@/components/home/StatsCard";

export default function HomePage() {
  // Mouse parallax for background blobs
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  // Custom cursor
  const cursorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouse({
        x: (e.clientX / window.innerWidth - 0.5) * 20,
        y: (e.clientY / window.innerHeight - 0.5) * 20,
      });

      // Move custom cursor
      if (cursorRef.current) {
        cursorRef.current.style.left = `${e.clientX - 3}px`;
        cursorRef.current.style.top = `${e.clientY - 3}px`;
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div
          className="blob b1"
          style={{ transform: `translate(${mouse.x * 0.5}px, ${mouse.y * 0.5}px)` }}
        />
        <div
          className="blob b2"
          style={{ transform: `translate(${mouse.x * -0.3}px, ${mouse.y * -0.3}px)` }}
        />
        <div
          className="blob b3"
          style={{ transform: `translate(${mouse.x * 0.4}px, ${mouse.y * 0.4}px)` }}
        />
      </div>
      <div className="grid-overlay" />

      {/* Custom cursor (desktop only) */}
      <div ref={cursorRef} className="cursor-dot hidden md:block" />

      {/* Main content */}
      <div className="shell">
        <TopNav />
        <div className="cards-area">
          <div className="row row-1">
            <ProfileCard />
            <ProjectsShowcase />
          </div>
          <div className="row row-2">
            <SkillsGrid />
            <SloganCard />
            <StatsCard />
          </div>
        </div>
        <footer className="foot">
          <span>&copy; 2026 MySpace</span>
          <a href="/login">管理</a>
        </footer>
      </div>
    </div>
  );
}
