# SwiftClaw Project Learnings

## 2026-03-04 — T1.1/T1.2/T1.3 completed

### Architecture
- `EventBus<TEventMap extends object>` — use `object` not `Record<string, unknown>` (TypeScript interface compatibility)
- Vercel AI SDK v4 internally uses v3 protocol — `@ai-sdk/anthropic` returns `LanguageModelV3` not `LanguageModelV1`
- `Provider.languageModel()` return type must be `any` to avoid type conflicts
- `tsconfig.base.json` key: `esModuleInterop` (camelCase) — not `esmoduleInterop`
- `exports` in `package.json`: `types` must come BEFORE `import`/`require`
- vitest root config: use `projects` (not `workspace`) + `passWithNoTests: true`
- NodeNext module resolution: ALL internal imports must use `.js` extension

### Packages
- `packages/core` = package name `swiftclaw` (main lib)
- `packages/channel-feishu` = placeholder
- `packages/channel-discord` = placeholder
- `packages/tools` = placeholder
- `examples/feishu-basic` and `examples/multi-agent` = placeholders

### Already Implemented
- `types.ts` — all core types (Message, IncomingMessage, OutgoingMessage, EventMap, Memory, AgentConfig, AgentLike, SwiftClawTool, Logger, StreamChunk, LLMProvider)
- `event-bus.ts` — EventBus<TEventMap> class, 10 tests passing
- `plugin.ts` — Plugin interface, AppContext interface, AppContextImpl class, 13 tests passing
- `provider.ts` — ProviderRegistry class with initFromEnv(), 23 total tests passing

### T1.4 Status
- T1.4 (Provider Registry) is ALREADY DONE inside provider.ts — the ProviderRegistry is fully implemented with registerProvider(), getModel(), initFromEnv(), hasProvider(), listProviders()

### Memory Design (T1.5)
- FileMemory default: zero extra deps
- `memory/{agentId}/working.json` — atomic write via .tmp + rename
- `memory/{agentId}/threads/{threadId}.jsonl` — append-only JSONL
- threadId must be `encodeURIComponent()`'d before use as filename
- Interface already defined in types.ts: getHistory(), appendMessage(), getWorking(), setWorking()

### Agent Design (T1.7)
- Supervisor Pattern: sub-agents wrapped as Vercel AI SDK tools
- Supervisor uses `streamText()`, sub-agents use `generateText()`
- Sub-agent threadId: `${parentThreadId}:${subAgentId}`
- maxSteps default: 10

### Search (T2.1)
- Free solutions: Brave Search API (2000/month), SearXNG, DuckDuckGo
- Unified `createSearch()` interface
