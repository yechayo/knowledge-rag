"use client";

import { useEffect, useRef, useState } from "react";

interface Ripple {
  id: number;
  startTime: number;
}

export default function CustomCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const posRef = useRef({ x: 0, y: 0 });

  // Animation loop for ripples
  useEffect(() => {
    if (ripples.length === 0) return;

    const animate = () => {
      setRipples(prev => {
        const now = Date.now();
        return prev.filter(r => now - r.startTime < 600);
      });
    };

    const loop = () => {
      animate();
      if (ripples.length > 0) {
        requestAnimationFrame(loop);
      }
    };

    requestAnimationFrame(loop);
  }, [ripples.length]);

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

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      posRef.current = { x: e.clientX, y: e.clientY };

      const target = e.target as HTMLElement;
      const isClickable =
        target.tagName === "A" ||
        target.tagName === "BUTTON" ||
        target.onclick !== null ||
        target.classList.contains("cursor-pointer") ||
        window.getComputedStyle(target).cursor === "pointer";

      setIsHovering(isClickable);
    };

    const handleClick = () => {
      // 创建多个波纹，形成涟漪效果
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          const newRipple: Ripple = {
            id: now + i,
            startTime: Date.now(),
          };
          setRipples(prev => [...prev, newRipple]);
        }, i * 100);
      }
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("click", handleClick);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("click", handleClick);
    };
  }, []);

  return (
    <div
      ref={cursorRef}
      className={`cursor-dot hidden md:block transition-transform duration-200 ease-out ${
        isHovering ? "scale-300 bg-white" : ""
      }`}
    >
      {/* Click ripples */}
      {ripples.map(ripple => {
        const elapsed = Date.now() - ripple.startTime;
        const progress = Math.min(elapsed / 600, 1);
        const scale = 1 + progress * 1.5;
        const opacity = 1 - progress;
        return (
          <div
            key={ripple.id}
            className="absolute rounded-full border border-white"
            style={{
              inset: -4,
              transform: `scale(${scale})`,
              opacity,
              boxShadow: `0 0 ${8 * opacity}px rgba(255,255,255,${opacity * 0.5})`,
            }}
          />
        );
      })}
    </div>
  );
}
