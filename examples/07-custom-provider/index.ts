/**
 * 07-custom-provider — 接入自定义 LLM Provider
 *
 * 覆盖三种接入方式:
 *
 *   方式 A │ OpenAI 兼容接口（最常见）
 *           │ 适用于: DeepSeek、月之暗面、硅基流动、智谱、本地 Ollama 等
 *           │ 依赖: @ai-sdk/openai 的 createOpenAI()
 *
 *   方式 B │ @ai-sdk/openai-compatible（灵活配置）
 *           │ 适用于: 需要自定义 headers、认证方式、特殊参数的接口
 *           │ 依赖: @ai-sdk/openai-compatible 的 createOpenAICompatible()
 *
 *   方式 C │ 完全手写 LanguageModelV1（任意协议）
 *           │ 适用于: 完全不兼容 OpenAI 格式的私有接口
 *           │ 依赖: @ai-sdk/provider 的 LanguageModelV1 类型
 *
 * 运行方式（按需选择）:
 *
 *   # 方式 A — DeepSeek
 *   PROVIDER=deepseek DEEPSEEK_API_KEY=sk-xxx tsx index.ts
 *
 *   # 方式 A — Ollama（本地，无需 API Key）
 *   PROVIDER=ollama OLLAMA_MODEL=qwen2.5:7b tsx index.ts
 *
 *   # 方式 A — 月之暗面 Moonshot
 *   PROVIDER=moonshot MOONSHOT_API_KEY=sk-xxx tsx index.ts
 *
 *   # 方式 A — 硅基流动 SiliconFlow
 *   PROVIDER=siliconflow SILICONFLOW_API_KEY=sk-xxx tsx index.ts
 *
 *   # 方式 B — 自定义兼容接口
 *   PROVIDER=compatible COMPATIBLE_BASE_URL=https://api.example.com/v1 COMPATIBLE_API_KEY=xxx COMPATIBLE_MODEL=my-model tsx index.ts
 *
 *   # 方式 C — 完全手写（内置 mock，无需真实 API）
 *   PROVIDER=mock tsx index.ts
 *
 *   # 方式 A — MiniMax（Anthropic 兼容接口，Thinking 模型）
 *   PROVIDER=minimax ANTHROPIC_API_KEY=sk-cp-xxx tsx index.ts
 */

import { SwiftClaw } from 'swiftclaw'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModelV1, LanguageModelV1CallOptions, LanguageModelV1StreamPart } from '@ai-sdk/provider'

// ─────────────────────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────────────────────

function divider(title: string) {
  console.log(`\n${'─'.repeat(55)}`)
  console.log(`  ${title}`)
  console.log('─'.repeat(55))
}

// ─────────────────────────────────────────────────────────────────────────────
// 方式 C 示例: 完全手写 LanguageModelV1
//
// 这里实现了一个 "Echo Model" — 它把用户输入原样回显。
// 现实中你可以在 doGenerate / doStream 里 fetch 任意私有 API。
// ─────────────────────────────────────────────────────────────────────────────

function createEchoModel(modelId: string): LanguageModelV1 {
  return {
    specificationVersion: 'v1',
    provider: 'echo-provider',
    modelId,
    defaultObjectGenerationMode: 'json',

    // ── 非流式生成 ────────────────────────────────────────────────────────────
    async doGenerate(options: LanguageModelV1CallOptions) {
      // 提取最后一条 user 消息内容
      const lastMsg = options.prompt.at(-1)
      const inputText =
        lastMsg?.role === 'user'
          ? lastMsg.content
              .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
              .map(p => p.text)
              .join('')
          : '(empty)'

      // 构造回复（实际场景里这里是你的 API 调用）
      const responseText = `[EchoModel/${modelId}] 你说的是: "${inputText}"`

      return {
        text: responseText,
        finishReason: 'stop' as const,
        usage: { promptTokens: inputText.length, completionTokens: responseText.length },
        rawCall: { rawPrompt: options.prompt, rawSettings: {} },
      }
    },

    // ── 流式生成 ──────────────────────────────────────────────────────────────
    async doStream(options: LanguageModelV1CallOptions) {
      const lastMsg = options.prompt.at(-1)
      const inputText =
        lastMsg?.role === 'user'
          ? lastMsg.content
              .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
              .map(p => p.text)
              .join('')
          : '(empty)'

      const responseText = `[EchoModel/${modelId}] 流式回显: "${inputText}"`

      // 把回复拆成单字 chunk，模拟流式输出
      const words = responseText.split('')

      async function* generateStream(): AsyncGenerator<LanguageModelV1StreamPart> {
        for (const char of words) {
          yield { type: 'text-delta', textDelta: char }
          // 模拟网络延迟（每个字 5ms）
          await new Promise(r => setTimeout(r, 5))
        }
        yield {
          type: 'finish',
          finishReason: 'stop',
          usage: { promptTokens: inputText.length, completionTokens: responseText.length },
        }
      }

      // LanguageModelV1 要求 ReadableStream，把 AsyncGenerator 转换过去
      const stream = new ReadableStream<LanguageModelV1StreamPart>({
        async start(controller) {
          for await (const part of generateStream()) {
            controller.enqueue(part)
          }
          controller.close()
        },
      })
      return {
        stream,
        rawCall: { rawPrompt: options.prompt, rawSettings: {} },
      }
    },
  }
}

// ── Echo Provider 包装（支持多个 model）─────────────────────────────────────
const echoProvider = {
  languageModel: (modelId: string) => createEchoModel(modelId),
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider 配置表
// ─────────────────────────────────────────────────────────────────────────────

interface ProviderConfig {
  description: string
  register: (app: SwiftClaw) => void
  model: string
  requiresEnv?: string[]
}

// ── 方式 A: MiniMax (Anthropic 兼容接口) ─────────────────────────────────────────
// MiniMax 提供了与 Anthropic API 兼容的接口，支持 Thinking 模型
// 运行: PROVIDER=minimax ANTHROPIC_API_KEY=sk-cp-xxx tsx index.ts

const PROVIDERS: Record<string, ProviderConfig> = {

  // ── 方式 A: MiniMax (Anthropic 兼容接口) ───────────────────────────────────
  minimax: {
    description: '方式 A — MiniMax M2.5 (Anthropic 兼容接口，支持 Thinking)',
    requiresEnv: ['ANTHROPIC_API_KEY'],
    register(app) {
      app.registerProvider('anthropic', createAnthropic({
        apiKey: process.env['ANTHROPIC_API_KEY']!,
        baseURL: 'https://api.minimaxi.com/anthropic/v1',
      }))
    },
    // MiniMax 支持: MiniMax-M2.5, MiniMax-M2.5-highspeed, MiniMax-M2.1, MiniMax-M2
    model: `anthropic/${process.env['MINIMAX_MODEL'] ?? 'MiniMax-M2.5'}`,
  },

  // ── 方式 A: DeepSeek ────────────────────────────────────────────────────────
  deepseek: {
    description: '方式 A — DeepSeek (OpenAI 兼容接口)',
    requiresEnv: ['DEEPSEEK_API_KEY'],
    register(app) {
      app.registerProvider('deepseek', createOpenAI({
        baseURL: 'https://api.deepseek.com/v1',
        apiKey: process.env['DEEPSEEK_API_KEY']!,
      }))
    },
    // DeepSeek 支持的模型: deepseek-chat (V3), deepseek-reasoner (R1)
    model: `deepseek/${process.env['DEEPSEEK_MODEL'] ?? 'deepseek-chat'}`,
  },

  // ── 方式 A: 月之暗面 Moonshot ───────────────────────────────────────────────
  moonshot: {
    description: '方式 A — 月之暗面 Moonshot (OpenAI 兼容接口)',
    requiresEnv: ['MOONSHOT_API_KEY'],
    register(app) {
      app.registerProvider('moonshot', createOpenAI({
        baseURL: 'https://api.moonshot.cn/v1',
        apiKey: process.env['MOONSHOT_API_KEY']!,
      }))
    },
    // Moonshot 模型: moonshot-v1-8k, moonshot-v1-32k, moonshot-v1-128k
    model: `moonshot/${process.env['MOONSHOT_MODEL'] ?? 'moonshot-v1-8k'}`,
  },

  // ── 方式 A: 硅基流动 SiliconFlow ───────────────────────────────────────────
  siliconflow: {
    description: '方式 A — 硅基流动 SiliconFlow (OpenAI 兼容接口)',
    requiresEnv: ['SILICONFLOW_API_KEY'],
    register(app) {
      app.registerProvider('siliconflow', createOpenAI({
        baseURL: 'https://api.siliconflow.cn/v1',
        apiKey: process.env['SILICONFLOW_API_KEY']!,
      }))
    },
    // 免费模型: Qwen/Qwen2.5-7B-Instruct, THUDM/glm-4-9b-chat
    model: `siliconflow/${process.env['SILICONFLOW_MODEL'] ?? 'Qwen/Qwen2.5-7B-Instruct'}`,
  },

  // ── 方式 A: 本地 Ollama ─────────────────────────────────────────────────────
  ollama: {
    description: '方式 A — 本地 Ollama (OpenAI 兼容接口，无需 API Key)',
    register(app) {
      app.registerProvider('ollama', createOpenAI({
        baseURL: process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434/v1',
        apiKey: 'ollama', // Ollama 不校验 key，随便填
      }))
    },
    // 需要先 `ollama pull <model>`
    model: `ollama/${process.env['OLLAMA_MODEL'] ?? 'qwen2.5:7b'}`,
  },

  // ── 方式 A: 智谱 ZhipuAI ───────────────────────────────────────────────────
  zhipu: {
    description: '方式 A — 智谱 ZhipuAI (OpenAI 兼容接口)',
    requiresEnv: ['ZHIPU_API_KEY'],
    register(app) {
      app.registerProvider('zhipu', createOpenAI({
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: process.env['ZHIPU_API_KEY']!,
      }))
    },
    // 智谱模型: glm-4, glm-4-flash (免费), glm-4-air
    model: `zhipu/${process.env['ZHIPU_MODEL'] ?? 'glm-4-flash'}`,
  },

  // ── 方式 B: 自定义 OpenAI 兼容接口 ─────────────────────────────────────────
  compatible: {
    description: '方式 B — 自定义兼容接口 (@ai-sdk/openai-compatible)',
    requiresEnv: ['COMPATIBLE_BASE_URL', 'COMPATIBLE_API_KEY'],
    register(app) {
      app.registerProvider('compatible', createOpenAICompatible({
        // 必须: Provider 名称（仅用于日志）
        name: 'my-custom-provider',
        // 必须: 你的 API base URL
        baseURL: process.env['COMPATIBLE_BASE_URL']!,
        // 认证 headers（支持任意自定义 header）
        headers: {
          'Authorization': `Bearer ${process.env['COMPATIBLE_API_KEY']}`,
          // 有些 API 用非标准的认证方式，直接加 header
          // 'X-API-Key': process.env['COMPATIBLE_API_KEY']!,
          // 'X-Tenant-ID': 'my-tenant',
        },
      }))
    },
    model: `compatible/${process.env['COMPATIBLE_MODEL'] ?? 'my-model'}`,
  },

  // ── 方式 C: 完全手写（内置 Mock，无需真实 API）──────────────────────────────
  mock: {
    description: '方式 C — 完全手写 LanguageModelV1（内置 Mock，无需 API Key）',
    register(app) {
      app.registerProvider('echo', echoProvider)
    },
    model: 'echo/echo-v1',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// 主函数
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // 选择要测试的 provider
  const providerKey = process.env['PROVIDER'] ?? 'mock'

  const config = PROVIDERS[providerKey]
  if (!config) {
    console.error(`❌ 未知 provider: "${providerKey}"`)
    console.error(`可选值: ${Object.keys(PROVIDERS).join(', ')}`)
    console.error('\n使用示例:')
    console.error('  PROVIDER=mock tsx index.ts')
    console.error('  PROVIDER=deepseek DEEPSEEK_API_KEY=sk-xxx tsx index.ts')
    console.error('  PROVIDER=ollama OLLAMA_MODEL=llama3.2 tsx index.ts')
    process.exit(1)
  }

  // 检查必须的环境变量
  const missing = (config.requiresEnv ?? []).filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error(`❌ 使用 "${providerKey}" 需要设置环境变量:`)
    missing.forEach(k => console.error(`   ${k}=your-value`))
    process.exit(1)
  }

  console.log(`\n🚀 SwiftClaw 自定义 Provider 示例`)
  console.log(`   Provider: ${providerKey}`)
  console.log(`   模式:     ${config.description}`)
  console.log(`   模型:     ${config.model}`)

  // ── 初始化应用 ─────────────────────────────────────────────────────────────
  const app = new SwiftClaw({ memoryDir: './tmp/memory-provider' })
  config.register(app)
  await app.start()

  const agent = app.createAgent({
    id: 'provider-demo',
    model: config.model,
    instructions: '你是一个简洁的中文助手，每次回复不超过 3 句话。',
  })

  // ── 测试 1: 单次问答 ────────────────────────────────────────────────────────
  divider('测试 1: 单次问答 (agent.run)')

  const q1 = '用一句话解释什么是大语言模型？'
  console.log(`用户: ${q1}`)
  const r1 = await agent.run('thread-1', q1)
  console.log(`Agent: ${r1}`)

  // ── 测试 2: 流式输出 ────────────────────────────────────────────────────────
  divider('测试 2: 流式输出 (agent.stream)')

  const q2 = '给我列举三种编程语言，一句话说明各自特点'
  console.log(`用户: ${q2}`)
  process.stdout.write('Agent: ')
  for await (const chunk of agent.stream('thread-2', q2)) {
    process.stdout.write(chunk)
  }
  console.log()

  // ── 测试 3: 多轮对话 ────────────────────────────────────────────────────────
  divider('测试 3: 多轮对话（验证 provider 支持 message history）')

  const threadId = 'thread-multi'
  const turns = [
    '我叫小李，是一名 iOS 开发者',
    '你还记得我的职业吗？',
  ]
  for (const msg of turns) {
    const reply = await agent.run(threadId, msg)
    console.log(`\n用户: ${msg}`)
    console.log(`Agent: ${reply}`)
  }

  // ── 完成 ──────────────────────────────────────────────────────────────────
  divider('✅ 全部测试完成')

  if (providerKey === 'mock') {
    console.log()
    console.log('你当前用的是内置 Mock Provider。要测试真实 Provider，运行:')
    console.log()
    console.log('  # DeepSeek (¥0.001/1K tokens，性价比极高)')
    console.log('  PROVIDER=deepseek DEEPSEEK_API_KEY=sk-xxx tsx index.ts')
    console.log()
    console.log('  # Ollama 本地模型（完全免费）')
    console.log('  ollama pull qwen2.5:7b')
    console.log('  PROVIDER=ollama tsx index.ts')
    console.log()
    console.log('  # 硅基流动（有免费额度）')
    console.log('  PROVIDER=siliconflow SILICONFLOW_API_KEY=sk-xxx tsx index.ts')
    console.log()
    console.log('  # 自定义兼容接口')
    console.log('  PROVIDER=compatible COMPATIBLE_BASE_URL=https://api.example.com/v1 \\')
    console.log('    COMPATIBLE_API_KEY=xxx COMPATIBLE_MODEL=my-model tsx index.ts')
  }

  await app.stop()
}

main().catch((err: unknown) => {
  console.error('❌ 出错了:', err)
  process.exit(1)
})
