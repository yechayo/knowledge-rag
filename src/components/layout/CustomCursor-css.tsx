"use client";

import { useEffect, useState } from "react";

// 使用 CSS cursor 的实现（无 JavaScript 位置更新）
export default function CustomCursorCss() {
  const [isHovering, setIsHovering] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    const handleMouseOver = (e: MouseEvent) => {
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

  // 设置初始 cursor 并使用 CSS cursor 变量
  useEffect(() => {
    // 初始设置
    document.body.style.cursor = "var(--cursor-default)";

    // 根据状态动态更新
    if (isEditing) {
      document.body.style.cursor = "text";
    } else if (isHovering) {
      document.body.style.cursor = "var(--cursor-hover)";
    } else {
      document.body.style.cursor = "var(--cursor-default)";
    }

    return () => {
      document.body.style.cursor = "auto";
    };
  }, [isHovering, isEditing]);

  return null; // 不渲染任何元素，只控制 cursor
}
