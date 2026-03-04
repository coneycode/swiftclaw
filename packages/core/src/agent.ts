import { streamText, generateText, tool } from 'ai'
import { z } from 'zod'
import type { AgentConfig, AgentLike, Memory, StreamChunk } from './types.js'
import type { ProviderRegistry } from './provider.js'
import { createToolMap } from './tool.js'

// ─── Agent ────────────────────────────────────────────────────────────────────

/**
 * Agent — SwiftClaw 的核心 AI 执行单元
 *
 * 支持两种模式:
 * 1. **普通 Agent** — 直接用 LLM 回答，可使用工具 (tools)
 * 2. **Supervisor Agent** — 当 config.subAgents 不为空时，自动进入 Supervisor 模式。
 *    每个子 Agent 被包装为 Vercel AI SDK tool，Supervisor LLM 自主决策何时委托。
 *
 * 线程设计:
 * - threadId 标识当前对话会话
 * - 子 Agent 的 threadId = `${parentThreadId}:${subAgentId}` （形成树状线程）
 *
 * 流式输出:
 * - `stream(threadId, userMessage)` — 返回 AsyncIterable<StreamChunk> 文本流
 * - `run(threadId, userMessage)` — 等待完成，返回最终 text 字符串
 */
export class Agent implements AgentLike {
  readonly config: AgentConfig
  private readonly providers: ProviderRegistry
  private readonly defaultMemory: Memory

  constructor(config: AgentConfig, providers: ProviderRegistry, defaultMemory: Memory) {
    this.config = config
    this.providers = providers
    this.defaultMemory = config.memory ?? defaultMemory
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * 流式执行 Agent。返回 AsyncIterable，调用方可 `for await` 接收文本 chunk。
   *
   * @param threadId   会话唯一标识（如 'feishu:oc_xxx'）
   * @param userText   用户消息
   */
  async *stream(threadId: string, userText: string): AsyncIterable<StreamChunk> {
    const memory = this.defaultMemory

    // 1. 把用户消息写入历史
    await memory.appendMessage(threadId, {
      role: 'user',
      content: userText,
      createdAt: Date.now(),
    })

    // 2. 读取历史上下文
    const history = await memory.getHistory(threadId)

    // 3. 构建 system prompt
    const systemPrompt = await resolveInstructions(this.config.instructions)

    // 4. 构建工具集（普通工具 + 子 Agent 工具）
    const tools = this._buildTools(threadId)

    // 5. 调用 streamText
    const model = this.providers.getModel(this.config.model)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (streamText as any)({
      model,
      system: systemPrompt,
      messages: history.map(m => ({ role: m.role, content: m.content })),
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      maxSteps: this.config.maxSteps ?? 10,
    })

    // 6. 收集文本流并 yield chunk
    //    注意：MiniMax M2.5 等 thinking 模型会在 textStream 里不返回文本，
    //    需要从 fullStream 里提取 type==='text-delta' 的部分。
    let fullText = ''
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        fullText += part.textDelta
        yield part.textDelta
      }
    }

    // 7. 写入 assistant 回复到历史
    await memory.appendMessage(threadId, {
      role: 'assistant',
      content: fullText,
      createdAt: Date.now(),
    })
  }

  /**
   * 非流式执行 Agent。等待完整回复后返回。
   *
   * @param threadId  会话唯一标识
   * @param userText  用户消息
   */
  async run(threadId: string, userText: string): Promise<string> {
    let fullText = ''
    for await (const chunk of this.stream(threadId, userText)) {
      fullText += chunk
    }
    return fullText
  }

  /**
   * 作为子 Agent 被 Supervisor 调用（内部使用 generateText 而非 streamText）
   *
   * @param subThreadId  子线程 ID（= `${parentThreadId}:${this.config.id}`）
   * @param prompt       Supervisor 委托的指令
   */
  async runAsSubAgent(subThreadId: string, prompt: string): Promise<string> {
    const memory = this.defaultMemory
    const systemPrompt = await resolveInstructions(this.config.instructions)

    // 先写入用户消息，再读取历史（确保 messages 不为空）
    await memory.appendMessage(subThreadId, {
      role: 'user',
      content: prompt,
      createdAt: Date.now(),
    })

    const history = await memory.getHistory(subThreadId)
    const model = this.providers.getModel(this.config.model)
    const tools = this._buildLeafTools() // 子 Agent 不能再有 Supervisor 层

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (generateText as any)({
      model,
      system: systemPrompt,
      messages: history.map(m => ({ role: m.role, content: m.content })),
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      maxSteps: this.config.maxSteps ?? 10,
    })

    const text = result.text
    await memory.appendMessage(subThreadId, {
      role: 'assistant',
      content: text,
      createdAt: Date.now(),
    })
    return text
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * 构建完整工具集：普通工具 + 子 Agent 工具（如果是 Supervisor）
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _buildTools(parentThreadId: string): Record<string, any> {
    const leafTools = this._buildLeafTools()
    const subAgentTools = this._buildSubAgentTools(parentThreadId)
    return { ...leafTools, ...subAgentTools }
  }

  /**
   * 普通工具（SwiftClawTool → AI SDK tool）
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _buildLeafTools(): Record<string, any> {
    return createToolMap(this.config.tools ?? {})
  }

  /**
   * 子 Agent 工具：每个子 Agent 包装为 tool，Supervisor LLM 自主调用
   */
  private _buildSubAgentTools(
    parentThreadId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Record<string, any> {
    const subAgents = this.config.subAgents
    if (!subAgents || Object.keys(subAgents).length === 0) return {}

    const entries = Object.entries(subAgents).map(([key, subAgentLike]) => {
      // 子 Agent 必须是真正的 Agent 实例（实现了 runAsSubAgent）
      const subAgent = subAgentLike as Agent
      const subThreadId = `${parentThreadId}:${subAgent.config.id}`

      const agentTool = tool({
        description:
          subAgent.config.description ??
          `Delegate to sub-agent "${subAgent.config.id}"`,
        parameters: z.object({
          prompt: z.string().describe('The task or question to delegate'),
        }),
        execute: async ({ prompt }: { prompt: string }) => {
          return subAgent.runAsSubAgent(subThreadId, prompt)
        },
      })

      return [key, agentTool] as [string, unknown]
    })

    return Object.fromEntries(entries)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveInstructions(
  instructions: AgentConfig['instructions'],
): Promise<string | undefined> {
  if (!instructions) return undefined
  if (typeof instructions === 'string') return instructions
  return instructions()
}
