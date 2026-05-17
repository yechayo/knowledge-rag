"use client";

import { useEffect } from "react";

export default function NativeCursor() {
  useEffect(() => {
    document.documentElement.style.cursor = "";
    document.body.style.cursor = "";
  }, []);

  return null;
}
