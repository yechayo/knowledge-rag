"use client";

import { useEffect, useRef, useState } from "react";

export default function CustomCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const posRef = useRef({ x: 0, y: 0 });

  // Continuous position update
  useEffect(() => {
    let animationId: number;

    const updatePosition = () => {
      if (cursorRef.current) {
        cursorRef.current.style.left = `${posRef.current.x - 4}px`;
        cursorRef.current.style.top = `${posRef.current.y - 4}px`;
      }
      animationId = requestAnimationFrame(updatePosition);
    };

    animationId = requestAnimationFrame(updatePosition);
    return () => cancelAnimationFrame(animationId);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      posRef.current = { x: e.clientX, y: e.clientY };

      const target = e.target as HTMLElement;
      const isClickable = (() => {
        let el: HTMLElement | null = target;
        while (el) {
          const style = window.getComputedStyle(el);
          if (style.cursor === "pointer") return true;
          if (
            el.tagName === "A" ||
            el.tagName === "BUTTON" ||
            el.tagName === "INPUT" ||
            el.tagName === "SELECT" ||
            el.tagName === "TEXTAREA" ||
            el.tagName === "SUMMARY" ||
            el.tagName === "LABEL" ||
            el.getAttribute("role") === "button" ||
            el.getAttribute("role") === "link" ||
            el.onclick !== null
          ) return true;
          el = el.parentElement;
        }
        return false;
      })();

      const isEditable = (() => {
        let el: HTMLElement | null = target;
        while (el) {
          if (
            el.isContentEditable ||
            el.tagName === "INPUT" ||
            el.tagName === "TEXTAREA" ||
            el.tagName === "SELECT"
          ) return true;
          el = el.parentElement;
        }
        return false;
      })();

      setIsHovering(isClickable);
      setIsEditing(isEditable);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <div
      ref={cursorRef}
      className={`cursor-dot hidden md:block transition-transform duration-200 ease-out ${
        isEditing ? "opacity-0" : ""
      } ${isHovering && !isEditing ? "scale-300 bg-white" : ""}`}
    />
  );
}
