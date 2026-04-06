"use client";

import ContentCard from "./ContentCard";
import AnimatedWrapper from "@/components/ui/AnimatedWrapper";

interface ContentItem {
  id: string;
  title: string;
  slug: string;
  category: string;
  metadata: {
    tags?: string[];
    description?: string;
    [key: string]: unknown;
  };
  status: string;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ContentGridProps {
  items: ContentItem[];
  isAdmin?: boolean;
}

export default function ContentGrid({ items, isAdmin = false }: ContentGridProps) {
  if (items.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {items.map((item, index) => (
        <AnimatedWrapper key={item.id} index={index} columns={3}>
          <ContentCard
            id={item.id}
            title={item.title}
            slug={item.slug}
            category={item.category}
            metadata={item.metadata}
            createdAt={item.createdAt}
            viewCount={item.viewCount}
            isAdmin={isAdmin}
          />
        </AnimatedWrapper>
      ))}
    </div>
  );
}
