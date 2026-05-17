"use client";

interface ChatFabProps {
  onClick: () => void;
  isOpen: boolean;
}

export default function ChatFab({ onClick, isOpen }: ChatFabProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 z-50 flex h-[64px] w-[64px] items-center justify-center rounded-[24px] transition-all hover:-translate-y-1"
      style={{
        background: "var(--accent)",
        border: "4px solid #7adfd7",
        boxShadow: "0 8px 0 var(--island-teal-deep), 0 18px 36px rgba(61,52,40,0.22)",
        color: "#fff",
      }}
      aria-label={isOpen ? "关闭聊天" : "打开聊天"}
    >
      {isOpen ? (
        // X 图标
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-white transition-colors"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      ) : (
        // 聊天图标
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-white transition-colors"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      )}
    </button>
  );
}
