# DeepSeek RAG Routing Design

**Date**: 2026-05-17
**Status**: Ready for written-spec review

## Problem

The current front-stage RAG assistant feels slow even for lightweight questions. The main `/api/chat` path does extra work before answering: it calls GLM for keyword analysis, performs multi-query retrieval, builds a large prompt, then runs a LangGraph ReAct loop. This makes simple greetings, direct questions, and single-hop knowledge-base questions all pay the cost of the heavier path.

The assistant also does not behave like a true ReAct agent when retrieval is needed. Retrieval is front-loaded before generation instead of being available as a tool the model can call when a question is complex or ambiguous.

The admin Agent Chat has a separate model selector, but its model configuration is currently browser-local and can fail to persist into the actual request state after refresh. Admin model configuration should be durable across devices while keeping the front-stage RAG default independent.

## Goals

- Use DeepSeek for all front-stage chat reasoning, intent classification, answer generation, and ReAct behavior.
- Keep Zhipu/GLM only for embeddings and existing non-chat indexing capabilities.
- Make `deepseek-v4-flash` the default speed-first RAG chat model.
- Route simple questions away from retrieval and ReAct when they do not need them.
- Use a hybrid intent classifier: local rules first, DeepSeek JSON classification only when rules are uncertain.
- Add a real knowledge-base retrieval tool for complex ReAct questions.
- Persist admin Agent model configurations in the database, with `localStorage` only remembering the active configuration id.
- Preserve citation behavior for knowledge-base answers.

## Non-Goals

- Do not replace the embedding model or rebuild the vector index.
- Do not make `/api/chat/v2` the front-stage default in this change.
- Do not change the admin Agent Chat default model strategy beyond fixing configuration persistence.
- Do not add DeepSeek Pro as the default; this design is speed-first.

## External Model Facts

DeepSeek's official API docs list `deepseek-v4-flash` and `deepseek-v4-pro` as current V4 model ids, with the OpenAI-format base URL `https://api.deepseek.com`. The official change log says `deepseek-chat` and `deepseek-reasoner` are legacy ids and will be discontinued on 2026-07-24.

Sources:

- [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [DeepSeek Change Log](https://api-docs.deepseek.com/updates)

## Model Configuration

Front-stage RAG chat reads these environment variables:

```env
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
RAG_MODEL_NAME=deepseek-v4-flash
RAG_CLASSIFIER_MODEL_NAME=deepseek-v4-flash
```

`DEEPSEEK_BASE_URL`, `RAG_MODEL_NAME`, and `RAG_CLASSIFIER_MODEL_NAME` have the defaults shown above. `DEEPSEEK_API_KEY` is required for `/api/chat`.

`BIGMODEL_API_KEY` remains required for `src/lib/embedding.ts` and any existing Zhipu-powered indexing or vision features. It must not be used as a fallback for front-stage chat generation.

## Architecture

`/api/chat` becomes a small orchestration layer around focused RAG chat modules:

```text
src/app/api/chat/route.ts
  -> src/lib/rag-chat/intent.ts
  -> src/lib/rag-chat/retrieve.ts
  -> src/lib/rag-chat/generate.ts
  -> src/lib/rag-chat/react.ts
```

### Intent Module

`src/lib/rag-chat/intent.ts` owns `classifyChatIntent(message, context)`.

It returns:

```ts
type RagChatRoute = "direct" | "retrieve_once" | "react_retrieve";

interface RagChatIntent {
  route: RagChatRoute;
  confidence: number;
  needsKnowledge: boolean;
  normalizedQuery: string;
  reason: string;
  source: "rules" | "deepseek" | "fallback";
}
```

Local rules run first. They classify obvious greetings, short conversational turns, explicit knowledge-base questions, site/content/category questions, and complex multi-hop questions. If local rules are uncertain, the module calls `deepseek-v4-flash` with a short JSON-only prompt. If classification fails or times out, the fallback route is `retrieve_once`.

### Retrieval Module

`src/lib/rag-chat/retrieve.ts` extracts the retrieval logic currently embedded in `/api/chat` and avoids internal HTTP calls to `/api/retrieve`.

It provides:

- `retrieveGrouped(query, options)` for grouped pgvector retrieval.
- `extractSources(grouped)` for citation source payloads.
- `buildKnowledgeBaseContext(grouped)` for prompt context.
- `searchKnowledgeBase(query)` as the implementation behind the ReAct tool.

Embedding generation still uses the existing Zhipu embedding function.

### Generate Module

`src/lib/rag-chat/generate.ts` owns DeepSeek answer generation.

It provides:

- `streamDirectAnswer(message, history, send, signal)`
- `streamRetrievedAnswer(message, grouped, sources, history, send, signal)`

`direct` answers do not retrieve knowledge-base content. `retrieve_once` answers must only cite links that are present in retrieved sources. If retrieval returns no useful content, the assistant should say the knowledge base has no relevant content and should not fabricate a `[[REF:...]]` marker.

### ReAct Module

`src/lib/rag-chat/react.ts` handles only complex RAG questions. It creates a LangGraph ReAct agent with DeepSeek and a small read-only tool set:

- `searchKnowledgeBase`: semantic search over published content.
- `list_content`: existing content listing tool.
- `list_categories`: existing category listing tool.

`searchKnowledgeBase` returns compact content snippets plus canonical links. ReAct remains bounded by existing guard limits and a route-specific recursion limit so complex questions cannot dominate the server.

## `/api/chat` Flow

1. Parse `message` and `sessionKey`.
2. Create or reuse the front-stage chat session.
3. Send an early SSE `init` event.
4. Classify intent with local rules first, then DeepSeek only if uncertain.
5. Send an optional SSE `route` event containing the selected route and classifier source.
6. Execute the selected path:
   - `direct`: DeepSeek streaming answer, no retrieval, no ReAct.
   - `retrieve_once`: one direct vector retrieval, DeepSeek streaming answer with citations.
   - `react_retrieve`: DeepSeek ReAct agent with `searchKnowledgeBase`.
7. Send `sources` if knowledge-base sources were used.
8. Persist assistant summary and usage log.
9. Release session resources and close the SSE stream.

## Performance Strategy

- Remove the GLM keyword-analysis call from `/api/chat`.
- Avoid internal `fetch("/api/retrieve")`; call the retrieval service directly.
- Do not initialize the heavy ReAct path for `direct` or `retrieve_once`.
- Keep local intent rules fast and synchronous.
- Keep model classification small: JSON only, low max tokens, short timeout.
- Send early SSE events so the UI leaves the idle state quickly.
- Record latency by phase: intent, retrieval, model, and total.

Usage tracking adds a JSON `metadata` field to `UsageLog`:

```ts
{
  route: "retrieve_once",
  intentSource: "rules",
  intentLatencyMs: 8,
  retrieveLatencyMs: 124,
  modelLatencyMs: 1420,
  totalLatencyMs: 1602
}
```

The same fields should also be emitted as structured server logs during rollout so latency can be inspected before opening the database.

## Citation Rules

Knowledge-base answers must preserve the existing inline citation format:

```text
[[REF:/category/slug#anchor|short label]]
```

Rules:

- `direct` answers should not include citations because they do not use the knowledge base.
- `retrieve_once` and `react_retrieve` answers must cite knowledge-base claims.
- Citation links must come from retrieved chunks or tool results.
- The model must not invent categories, slugs, anchors, or URLs.

## Error Handling

- Missing `DEEPSEEK_API_KEY`: return an SSE error explaining the front-stage chat model is not configured.
- Intent classifier timeout/error: route to `retrieve_once`.
- Retrieval error in `retrieve_once`: return an SSE error unless there is enough context to safely answer without the knowledge base.
- Empty retrieval result: answer that the knowledge base has no relevant content.
- DeepSeek generation error: return an SSE error and log the provider response status.
- ReAct guard stop: return the best available partial answer if safe, otherwise return a concise failure message.
- Client abort: cancel provider fetches, release the session lock, and close the stream.

## Admin Model Configuration Persistence

Admin Agent Chat remains configurable and independent from the front-stage RAG default.

Add a dedicated persistence model rather than storing API keys in `SiteConfig`:

```prisma
model AgentModelConfig {
  id        String   @id @default(cuid())
  name      String
  modelName String
  baseURL   String
  apiKey    String
  isDefault Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([isDefault])
}
```

Only admins can access these APIs:

- `GET /api/agent/model-configs`
- `POST /api/agent/model-configs`
- `PATCH /api/agent/model-configs/[id]`
- `DELETE /api/agent/model-configs/[id]`

API key handling:

- GET responses must not return plaintext keys.
- GET returns `hasApiKey` and a masked key preview.
- PATCH preserves the previous API key when `apiKey` is omitted or blank.
- POST requires an API key.

Frontend behavior:

- `ModelSelector` loads saved configs from the API.
- `localStorage` stores only the active config id.
- If the active id still exists, the selector restores it and sends only that id to the stream API.
- If the active id was deleted, the selector falls back to environment/default model behavior.
- `/api/agent/stream` continues to use the selected admin model config and remains separate from `/api/chat`.

Request pattern:

The frontend sends `modelConfigId`, and `/api/agent/stream` loads the API key server-side. API keys stay server-side after persistence and are not sent back to the browser in normal GET responses.

## Testing

Add focused tests for intent routing:

- Greeting or lightweight conversational input routes to `direct`.
- Explicit knowledge-base question routes to `retrieve_once`.
- Comparison, summary across multiple documents, ambiguous follow-up, or multi-hop question routes to `react_retrieve`.
- Uncertain rule result calls DeepSeek classifier.
- Classifier failure falls back to `retrieve_once`.

Add retrieval/generation tests where practical:

- `retrieve_once` builds context and sources from grouped retrieval.
- Empty retrieval produces a no-content answer path.
- Citation source extraction does not invent links.

Add admin model config tests:

- Create, update, delete model config.
- GET masks API keys.
- PATCH without `apiKey` preserves the stored secret.
- Deleted active config falls back cleanly.
- Admin-only access is enforced.

Manual verification:

- Front-stage chat responds to a greeting without retrieval.
- Front-stage chat answers a simple knowledge-base question with citations.
- A complex question emits route `react_retrieve` and can call `searchKnowledgeBase`.
- Admin model selector survives refresh and sends the selected model to `/api/agent/stream`.

Expected verification commands:

```bash
pnpm lint
pnpm vitest run
```

## Rollout Notes

The implementation should be done in small steps:

1. Add DeepSeek RAG model factory and environment variables.
2. Extract retrieval helpers without changing behavior.
3. Add intent routing and direct/retrieve-once paths.
4. Add ReAct `searchKnowledgeBase` path.
5. Add admin model config persistence.
6. Add tests and run verification.

The old GLM keyword analysis code can be removed after the new routes are covered by tests.
