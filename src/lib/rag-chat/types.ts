export type RagChatRoute = "direct" | "retrieve_once" | "react_retrieve";

export interface RagChatIntent {
  route: RagChatRoute;
  confidence: number;
  needsKnowledge: boolean;
  normalizedQuery: string;
  reason: string;
  source: "rules" | "deepseek" | "fallback";
  localReply?: string;
}

export interface GroupedChunk {
  chunkId: string;
  contentId: string;
  title: string;
  slug: string;
  category: string;
  content: string;
  score: number;
  chunkType: string;
  headingLevel?: number | null;
  headingAnchor?: string | null;
  headingText?: string | null;
  sectionPath?: string | null;
  sourceTitle?: string | null;
  sourceTags?: string[];
}

export interface GroupedResult {
  nav_structure: GroupedChunk[];
  content_meta: GroupedChunk[];
  toc_entry: GroupedChunk[];
  content_body: GroupedChunk[];
}

export interface SourceCitation {
  title: string;
  slug: string;
  category: string;
  headingAnchor?: string | null;
  headingText?: string | null;
  sectionPath?: string | null;
  contentPreview: string;
}
