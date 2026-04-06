"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";

interface AnimatedWrapperProps {
  children: React.ReactNode;
  index?: number;
  columns?: number;
  staggerDelay?: number;
  threshold?: number;
  className?: string;
}

export default function AnimatedWrapper({
  children,
  index = 0,
  columns = 1,
  staggerDelay = 100,
  threshold = 0.1,
  className = "",
}: AnimatedWrapperProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: threshold });
  const rowDelay = Math.floor(index / columns) * (staggerDelay / 1000);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : undefined}
      transition={{
        duration: 0.5,
        delay: rowDelay,
        ease: [0.25, 0.1, 0.25, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
