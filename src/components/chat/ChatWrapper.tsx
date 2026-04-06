"use client";

import { useState } from "react";
import ChatFab from "./ChatFab";
import ChatPanel from "./ChatPanel";

export default function ChatWrapper() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <ChatPanel isOpen={isOpen} onClose={() => setIsOpen(false)} />
      <ChatFab onClick={() => setIsOpen(!isOpen)} isOpen={isOpen} />
    </>
  );
}
