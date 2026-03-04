# SwiftClaw

**English** · [中文](./README.zh-CN.md)

**Lightweight, extensible multi-channel AI assistant framework.**  
Built on [Vercel AI SDK](https://sdk.vercel.ai/) · TypeScript 5 · pnpm monorepo · MIT

---

## Features

- 🔌 **Plugin System** — coarse-grained plugins for channels, tools, and extensions
- 🤖 **Supervisor Pattern** — LLM autonomously delegates to specialized sub-agents
- 💾 **FileMemory** — zero-dependency file-based memory (per-thread history + working memory)
- 🔍 **Search Tools** — Brave Search / SearXNG / DuckDuckGo (free, unified interface)
- 📨 **Feishu Channel** — native Feishu/Lark bot support via WebSocket
- 💬 **Discord Channel** — Discord bot support
- 🧩 **Vercel AI SDK** — works with Anthropic, OpenAI, Ollama, and 20+ providers

---

## Quick Start

```bash
npm install swiftclaw @ai-sdk/anthropic
# or
pnpm add swiftclaw @ai-sdk/anthropic
```

```typescript
import { SwiftClaw } from 'swiftclaw'
import { createAnthropic } from '@ai-sdk/anthropic'

const app = new SwiftClaw()

app.registerProvider('anthropic', createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
}))

const agent = app.createAgent({
  id: 'my-assistant',
  model: 'anthropic/claude-haiku-3-5',
  instructions: 'You are a helpful assistant.',
})

await app.start()

const reply = await agent.run('my-thread', 'Hello!')
console.log(reply) // "Hello! How can I help you today?"

await app.stop()
```

---

## Architecture

```
SwiftClaw (main class)
  ├── ProviderRegistry        — LLM provider management ('anthropic/claude-...')
  ├── Memory (FileMemory)     — Thread history + agent working memory
  ├── EventBus                — Typed event bus (message.received, message.reply, etc.)
  ├── Plugin[]                — Channels and extensions register here
  │   ├── FeishuChannel       — Feishu/Lark WebSocket bot
  │   └── DiscordChannel      — Discord bot
  └── Agent                   — AI execution unit
      ├── run(threadId, text) — Non-streaming
      ├── stream(threadId, text) — Streaming (AsyncIterable)
      └── subAgents: {...}    — Supervisor mode (LLM delegates to sub-agents)
```

---

## Packages

| Package | Description |
|---------|-------------|
| `swiftclaw` | Core framework (EventBus, Agent, Memory, Plugins) |
| `@swiftclaw/feishu` | Feishu/Lark channel plugin |
| `@swiftclaw/discord` | Discord channel plugin |
| `@swiftclaw/tools` | Built-in tools (search: Brave, DuckDuckGo, SearXNG) |

---

## Agents

### Basic Agent

```typescript
const agent = app.createAgent({
  id: 'writer',
  model: 'anthropic/claude-sonnet-4-5',
  instructions: 'You are a creative writing assistant.',
  tools: {
    search: createSearch(createBraveSearch({ apiKey: process.env.BRAVE_API_KEY })),
  },
})

const reply = await agent.run('session-1', 'Write a haiku about TypeScript')
```

### Supervisor Agent (Multi-Agent)

```typescript
const searchAgent = app.createAgent({
  id: 'search',
  model: 'anthropic/claude-haiku-3-5',
  description: 'Search the web for current information',
  tools: { search: createSearch(createDuckDuckGoSearch()) },
})

const writerAgent = app.createAgent({
  id: 'writer',
  model: 'anthropic/claude-haiku-3-5',
  description: 'Write, edit, translate, and summarize text',
})

// Supervisor — LLM decides when to delegate
const supervisor = app.createAgent({
  id: 'supervisor',
  model: 'anthropic/claude-sonnet-4-5',
  subAgents: { searchAgent, writerAgent },
})
```

### Streaming

```typescript
for await (const chunk of agent.stream('thread-1', 'Tell me a story')) {
  process.stdout.write(chunk)
}
```

---

## Channels

### Feishu (Lark)

```typescript
import { FeishuChannel } from '@swiftclaw/feishu'

app.use(new FeishuChannel({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  handleMessage: (threadId, userId, text) => agent.run(threadId, text),
}))
```

### Discord

```typescript
import { DiscordChannel } from '@swiftclaw/discord'

app.use(new DiscordChannel({
  token: process.env.DISCORD_BOT_TOKEN,
  triggerMode: 'mention', // only respond when @mentioned
  handleMessage: (threadId, userId, text) => agent.run(threadId, text),
}))
```

---

## Memory

SwiftClaw uses `FileMemory` by default — zero dependencies, works out of the box:

```typescript
// Default: stores in ./memory/
const app = new SwiftClaw()

// Custom directory:
const app = new SwiftClaw({ memoryDir: '/data/my-bot-memory' })

// Custom memory implementation (e.g., Redis, SQLite):
const app = new SwiftClaw({ memory: new MyCustomMemory() })
```

Memory layout:
```
memory/
  threads/
    {encodedThreadId}.jsonl    ← conversation history (append-only)
  {agentId}/
    working.json               ← agent working memory (atomic writes)
```

---

## Search Tools

```typescript
import { createSearch, createBraveSearch, createDuckDuckGoSearch, createSearXNGSearch } from '@swiftclaw/tools'

// Brave Search (2000 free requests/month)
const brave = createSearch(createBraveSearch({ apiKey: process.env.BRAVE_API_KEY }))

// DuckDuckGo (free, no API key)
const ddg = createSearch(createDuckDuckGoSearch())

// SearXNG (self-hosted, unlimited)
const searxng = createSearch(createSearXNGSearch({ instanceUrl: 'https://searx.example.com' }))
```

---

## Custom Plugins

```typescript
import type { Plugin, AppContext } from 'swiftclaw'

const myPlugin: Plugin = {
  name: 'my-plugin',
  register(ctx: AppContext) {
    // Listen for incoming messages
    ctx.on('message.received', async (msg) => {
      console.log(`Message from ${msg.channel}: ${msg.text}`)
    })
  },
  async stop() {
    // Cleanup: close connections, etc.
  },
}

app.use(myPlugin)
```

---

## Configuration

| Environment Variable | Description |
|---------------------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (auto-registered with `initProvidersFromEnv()`) |
| `OPENAI_API_KEY` | OpenAI API key (auto-registered with `initProvidersFromEnv()`) |
| `FEISHU_APP_ID` | Feishu application ID |
| `FEISHU_APP_SECRET` | Feishu application secret |
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `BRAVE_API_KEY` | Brave Search API key |

---

## Examples

- [`examples/01-basic-agent`](./examples/01-basic-agent/) — Single-turn, streaming, multi-turn conversation
- [`examples/02-memory`](./examples/02-memory/) — FileMemory usage and persistence
- [`examples/03-tools`](./examples/03-tools/) — Calculator, weather, search tools
- [`examples/04-multi-agent`](./examples/04-multi-agent/) — Supervisor + 4 specialist sub-agents
- [`examples/05-plugins`](./examples/05-plugins/) — EventBus and plugin lifecycle
- [`examples/07-custom-provider`](./examples/07-custom-provider/) — DeepSeek / Ollama / MiniMax / mock providers

---

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test

# Type-check all packages
pnpm typecheck

# Watch mode
pnpm dev
```

---

## License

MIT © SwiftClaw Contributors
