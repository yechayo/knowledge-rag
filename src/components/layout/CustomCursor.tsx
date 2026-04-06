"use client";

import { useEffect, useRef, useState } from "react";

export default function CustomCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isOutside, setIsOutside] = useState(false);

  // 光标位置更新
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setIsOutside(false);
      if (cursorRef.current) {
        cursorRef.current.style.left = `${e.clientX - 4}px`;
        cursorRef.current.style.top = `${e.clientY - 4}px`;
      }
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // 检测 hover 状态
  useEffect(() => {
    const handleMouseOver = (e: MouseEvent) => {
      setIsOutside(false);
      const target = e.target as HTMLElement;
      let isClickable = false;
      let isEditable = false;

      let el: HTMLElement | null = target;
      while (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        if (style.cursor === "pointer") {
          isClickable = true;
          break;
        }
        if (
          el.tagName === "A" ||
          el.tagName === "BUTTON" ||
          el.tagName === "INPUT" ||
          el.tagName === "SELECT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SUMMARY" ||
          el.tagName === "LABEL" ||
          el.getAttribute("role") === "button" ||
          el.getAttribute("role") === "link"
        ) {
          isClickable = true;
          break;
        }
        if (
          el.isContentEditable ||
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT"
        ) {
          isEditable = true;
          break;
        }
        el = el.parentElement;
      }

      setIsHovering(isClickable);
      setIsEditing(isEditable);
    };

    window.addEventListener("mouseover", handleMouseOver, { passive: true });
    return () => window.removeEventListener("mouseover", handleMouseOver);
  }, []);

  // 处理鼠标离开窗口
  useEffect(() => {
    const handleMouseLeave = () => {
      setIsOutside(true);
    };

    document.addEventListener("mouseleave", handleMouseLeave);
    return () => document.removeEventListener("mouseleave", handleMouseLeave);
  }, []);

  // 鼠标离开窗口时隐藏光标
  useEffect(() => {
    if (cursorRef.current) {
      cursorRef.current.style.opacity = isOutside ? "0" : "1";
    }
  }, [isOutside]);

  // 禁用原生光标
  useEffect(() => {
    document.body.style.cursor = "none";
    return () => {
      document.body.style.cursor = "auto";
    };
  }, []);

  // 动态样式
  const cursorStyle: React.CSSProperties = {
    backgroundColor: isHovering && !isEditing ? "var(--cursor-hover-color)" : "var(--accent)",
    transform: isHovering && !isEditing ? "translate(-50%, -50%) scale(1.5)" : "translate(-50%, -50%) scale(1)",
    transition: "opacity 100ms ease, transform 100ms ease, background-color 100ms ease",
    willChange: "transform, opacity, background-color" as any,
  };

  return (
    <div
      ref={cursorRef}
      className="cursor-dot hidden md:block"
      style={cursorStyle}
    />
  );
}
