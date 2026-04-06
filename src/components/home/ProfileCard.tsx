"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const socials = [
  {
    label: "GitHub",
    href: "https://github.com",
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
      </svg>
    ),
  },
  {
    label: "Twitter",
    href: "https://twitter.com",
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    label: "Email",
    href: "mailto:hello@example.com",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
        />
      </svg>
    ),
  },
];

export default function ProfileCard() {
  const [name, setName] = useState("yechayo");
  const [bio, setBio] = useState("个人知识管理与 RAG 问答平台");

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((config) => {
        if (config.siteName) setName(config.siteName);
        if (config.siteBio) setBio(config.siteBio);
      })
      .catch(() => {});
  }, []);

  const avatar = name.slice(0, 1).toUpperCase();

  return (
    <div className="card flex flex-col items-center justify-center text-center h-full">
      {/* Avatar ring */}
      <div className="avatar-ring mb-4">
        <span className="avatar-letter">{avatar}</span>
      </div>

      {/* Name & Bio */}
      <h2 className="text-lg font-bold" style={{ color: "var(--text-1)" }}>
        {name}
      </h2>
      <p className="text-sm mt-1" style={{ color: "var(--text-2)" }}>
        {bio}
      </p>

      {/* Buttons */}
      <div className="flex gap-3 mt-5">
        <Link
          href="/about"
          className="px-5 py-2 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90"
          style={{ background: "var(--accent)" }}
        >
          关于我
        </Link>
        <Link
          href="/message"
          className="px-5 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-80"
          style={{
            color: "var(--text-2)",
            border: "1px solid var(--border)",
          }}
        >
          留言
        </Link>
      </div>

      {/* Social icons */}
      <div className="flex gap-3 mt-5">
        {socials.map((s) => (
          <a
            key={s.label}
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={s.label}
            className="p-2 rounded-lg transition-all hover:scale-110"
            style={{
              color: "var(--text-3)",
              border: "1px solid var(--border)",
            }}
          >
            {s.icon}
          </a>
        ))}
      </div>
    </div>
  );
}
