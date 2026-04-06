"use client";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({
  currentPage,
  totalPages,
  onPageChange,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  // Calculate visible page range (show at most 5 pages)
  function getPageNumbers(): (number | "...")[] {
    const pages: (number | "...")[] = [];

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
      return pages;
    }

    pages.push(1);

    if (currentPage > 3) {
      pages.push("...");
    }

    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (currentPage < totalPages - 2) {
      pages.push("...");
    }

    pages.push(totalPages);

    return pages;
  }

  const pages = getPageNumbers();

  return (
    <nav className="flex items-center justify-center gap-1.5">
      {/* Prev button */}
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        className="flex items-center justify-center w-9 h-9 rounded-lg text-sm transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          color: "var(--text-2)",
        }}
      >
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
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </button>

      {/* Page buttons */}
      {pages.map((page, idx) =>
        page === "..." ? (
          <span
            key={`ellipsis-${idx}`}
            className="flex items-center justify-center w-9 h-9 text-sm"
            style={{ color: "var(--text-3)" }}
          >
            ...
          </span>
        ) : (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            className="flex items-center justify-center w-9 h-9 rounded-lg text-sm font-medium transition-all duration-200"
            style={{
              background:
                page === currentPage ? "var(--accent)" : "var(--card)",
              color: page === currentPage ? "#fff" : "var(--text-2)",
              border:
                page === currentPage
                  ? "1px solid var(--accent)"
                  : "1px solid var(--border)",
            }}
          >
            {page}
          </button>
        )
      )}

      {/* Next button */}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="flex items-center justify-center w-9 h-9 rounded-lg text-sm transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          color: "var(--text-2)",
        }}
      >
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
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>
    </nav>
  );
}
