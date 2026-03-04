# SwiftClaw

[English](./README.md) · **中文**

**轻量、可扩展的多渠道 AI 助手框架。**  
基于 [Vercel AI SDK](https://sdk.vercel.ai/) · TypeScript 5 · pnpm monorepo · MIT

---

## 特性

- 🔌 **插件系统** — 支持渠道、工具和扩展的粗粒度插件
- 🤖 **Supervisor 模式** — LLM 自主将任务委派给专属子智能体
- 💾 **FileMemory** — 零依赖、基于文件的持久化记忆（每线程历史 + 工作记忆）
- 🔍 **搜索工具** — Brave Search / SearXNG / DuckDuckGo（免费，统一接口）
- 📨 **飞书渠道** — 原生支持飞书/Lark 机器人（WebSocket）
- 💬 **Discord 渠道** — Discord 机器人支持
- 🧩 **Vercel AI SDK** — 兼容 Anthropic、OpenAI、Ollama 等 20+ 模型提供商

---

## 快速开始

```bash
npm install swiftclaw @ai-sdk/anthropic
# 或
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
  instructions: '你是一个有帮助的助手。',
})

await app.start()

const reply = await agent.run('my-thread', '你好！')
console.log(reply) // "你好！有什么我可以帮你的吗？"

await app.stop()
```

---

## 架构

```
SwiftClaw（主类）
  ├── ProviderRegistry        — LLM 提供商管理（'anthropic/claude-...'）
  ├── Memory (FileMemory)     — 线程历史 + 智能体工作记忆
  ├── EventBus                — 类型化事件总线（message.received、message.reply 等）
  ├── Plugin[]                — 渠道和扩展在此注册
  │   ├── FeishuChannel       — 飞书/Lark WebSocket 机器人
  │   └── DiscordChannel      — Discord 机器人
  └── Agent                   — AI 执行单元
      ├── run(threadId, text) — 非流式
      ├── stream(threadId, text) — 流式（AsyncIterable）
      └── subAgents: {...}    — Supervisor 模式（LLM 委派给子智能体）
```

---

## 包结构

| 包名 | 说明 |
|------|------|
| `swiftclaw` | 核心框架（EventBus、Agent、Memory、Plugins） |
| `@swiftclaw/feishu` | 飞书/Lark 渠道插件 |
| `@swiftclaw/discord` | Discord 渠道插件 |
| `@swiftclaw/tools` | 内置工具（搜索：Brave、DuckDuckGo、SearXNG） |

---

## 智能体

### 基础智能体

```typescript
const agent = app.createAgent({
  id: 'writer',
  model: 'anthropic/claude-sonnet-4-5',
  instructions: '你是一个创意写作助手。',
  tools: {
    search: createSearch(createBraveSearch({ apiKey: process.env.BRAVE_API_KEY })),
  },
})

const reply = await agent.run('session-1', '写一首关于 TypeScript 的俳句')
```

### Supervisor 智能体（多智能体）

```typescript
const searchAgent = app.createAgent({
  id: 'search',
  model: 'anthropic/claude-haiku-3-5',
  description: '搜索网络获取最新信息',
  tools: { search: createSearch(createDuckDuckGoSearch()) },
})

const writerAgent = app.createAgent({
  id: 'writer',
  model: 'anthropic/claude-haiku-3-5',
  description: '撰写、编辑、翻译和总结文本',
})

// Supervisor — LLM 自主决定何时委派
const supervisor = app.createAgent({
  id: 'supervisor',
  model: 'anthropic/claude-sonnet-4-5',
  subAgents: { searchAgent, writerAgent },
})
```

### 流式输出

```typescript
for await (const chunk of agent.stream('thread-1', '给我讲个故事')) {
  process.stdout.write(chunk)
}
```

---

## 渠道

### 飞书（Lark）

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
  triggerMode: 'mention', // 仅在被 @ 时响应
  handleMessage: (threadId, userId, text) => agent.run(threadId, text),
}))
```

---

## 记忆

SwiftClaw 默认使用 `FileMemory` —— 零依赖，开箱即用：

```typescript
// 默认：存储在 ./memory/
const app = new SwiftClaw()

// 自定义目录：
const app = new SwiftClaw({ memoryDir: '/data/my-bot-memory' })

// 自定义记忆实现（如 Redis、SQLite）：
const app = new SwiftClaw({ memory: new MyCustomMemory() })
```

记忆目录结构：
```
memory/
  threads/
    {encodedThreadId}.jsonl    ← 对话历史（仅追加）
  {agentId}/
    working.json               ← 智能体工作记忆（原子写入）
```

---

## 搜索工具

```typescript
import { createSearch, createBraveSearch, createDuckDuckGoSearch, createSearXNGSearch } from '@swiftclaw/tools'

// Brave Search（每月 2000 次免费请求）
const brave = createSearch(createBraveSearch({ apiKey: process.env.BRAVE_API_KEY }))

// DuckDuckGo（免费，无需 API 密钥）
const ddg = createSearch(createDuckDuckGoSearch())

// SearXNG（自托管，无限次）
const searxng = createSearch(createSearXNGSearch({ instanceUrl: 'https://searx.example.com' }))
```

---

## 自定义插件

```typescript
import type { Plugin, AppContext } from 'swiftclaw'

const myPlugin: Plugin = {
  name: 'my-plugin',
  register(ctx: AppContext) {
    // 监听传入消息
    ctx.on('message.received', async (msg) => {
      console.log(`来自 ${msg.channel} 的消息：${msg.text}`)
    })
  },
  async stop() {
    // 清理：关闭连接等
  },
}

app.use(myPlugin)
```

---

## 配置

| 环境变量 | 说明 |
|----------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥（通过 `initProvidersFromEnv()` 自动注册） |
| `OPENAI_API_KEY` | OpenAI API 密钥（通过 `initProvidersFromEnv()` 自动注册） |
| `FEISHU_APP_ID` | 飞书应用 ID |
| `FEISHU_APP_SECRET` | 飞书应用密钥 |
| `DISCORD_BOT_TOKEN` | Discord 机器人 Token |
| `BRAVE_API_KEY` | Brave Search API 密钥 |

---

## 示例

- [`examples/01-basic-agent`](./examples/01-basic-agent/) — 单轮、流式、多轮对话
- [`examples/02-memory`](./examples/02-memory/) — FileMemory 使用与持久化
- [`examples/03-tools`](./examples/03-tools/) — 计算器、天气、搜索工具
- [`examples/04-multi-agent`](./examples/04-multi-agent/) — Supervisor + 4 个专属子智能体
- [`examples/05-plugins`](./examples/05-plugins/) — EventBus 与插件生命周期
- [`examples/07-custom-provider`](./examples/07-custom-provider/) — DeepSeek / Ollama / MiniMax / mock 提供商

---

## 开发

```bash
# 安装依赖
pnpm install

# 构建所有包
pnpm build

# 运行所有测试
pnpm test

# 类型检查所有包
pnpm typecheck

# 监听模式
pnpm dev
```

---

## 许可证

MIT © SwiftClaw Contributors
