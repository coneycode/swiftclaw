import type { z } from 'zod'

// ─── Message ──────────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'system'

export interface Message {
  role: MessageRole
  content: string
  id?: string
  createdAt?: number
}

// ─── Channel Messages ─────────────────────────────────────────────────────────

export interface IncomingMessage {
  /** 渠道标识，如 'feishu' | 'discord' */
  channel: string
  /** 会话唯一标识，如 'feishu:oc_xxx' */
  threadId: string
  /** 发送者 ID */
  userId: string
  /** 消息文本内容（已清洗，去掉 @机器人 等） */
  text: string
  /** 原始消息体，供 Channel 插件内部使用 */
  raw?: unknown
}

export interface OutgoingMessage {
  /** 目标渠道标识 */
  channel: string
  /** 目标会话 ID */
  threadId: string
  /** 回复文本 */
  text: string
}

// ─── Events ───────────────────────────────────────────────────────────────────

export interface AgentStartEvent {
  agentId: string
  threadId: string
}

export interface AgentDoneEvent {
  agentId: string
  threadId: string
  finishReason?: string
}

export interface AgentErrorEvent {
  agentId: string
  error: unknown
}

export interface EventMap {
  'message.received': IncomingMessage
  'message.reply': OutgoingMessage
  'agent.start': AgentStartEvent
  'agent.done': AgentDoneEvent
  'agent.error': AgentErrorEvent
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

export interface SwiftClawTool<TInput = unknown, TOutput = unknown> {
  description: string
  parameters: z.ZodType<TInput>
  execute: (input: TInput) => Promise<TOutput>
}

// ─── Memory ───────────────────────────────────────────────────────────────────

export interface Memory {
  // Layer 1: 近期对话（滚动窗口）
  getHistory(threadId: string, limit?: number): Promise<Message[]>
  appendMessage(threadId: string, msg: Message): Promise<void>

  // Layer 2: 工作记忆（结构化持久信息）
  getWorking(agentId: string): Promise<Record<string, unknown>>
  setWorking(agentId: string, data: Record<string, unknown>): Promise<void>

  // Layer 3: 语义召回（可选，MVP 不实现）
  search?(query: string, agentId: string, topK?: number): Promise<Message[]>
}

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * Vercel AI SDK Provider 接口（简化引用）
 * 实际类型来自 'ai' 包的 Provider 接口
 */
export interface LLMProvider {
  languageModel(modelId: string): unknown
  embeddingModel?(modelId: string): unknown
}

// ─── Agent ────────────────────────────────────────────────────────────────────

// 前向声明，避免循环引用（Agent 类在 agent.ts 中定义）
export interface AgentLike {
  readonly config: AgentConfig
}

export interface AgentConfig {
  /** Agent 唯一标识 */
  id: string
  /**
   * Agent 描述，Sub-Agent 必须填写。
   * Supervisor LLM 依赖此描述决定何时委托给该 Agent。
   */
  description?: string
  /** 使用的模型，格式为 'provider/model'，如 'anthropic/claude-sonnet-4-5' */
  model: string
  /** Agent 的系统指令，可以是字符串或返回字符串的函数（支持动态指令） */
  instructions?: string | (() => string | Promise<string>)
  /** 可用工具 */
  tools?: Record<string, SwiftClawTool>
  /**
   * 子 Agent Map。有此字段时，当前 Agent 自动成为 Supervisor。
   * Supervisor 会把每个 Sub-Agent 转换为一个 tool，让 LLM 自主决策委托。
   */
  subAgents?: Record<string, AgentLike>
  /** 记忆实现，不传则使用 App 级别的默认 Memory */
  memory?: Memory
  /**
   * 最大步骤数（透传给 Vercel AI SDK streamText 的 maxSteps）。
   * 默认 10，防止无限委托循环。
   */
  maxSteps?: number
}

// ─── Stream ───────────────────────────────────────────────────────────────────

/** 流式输出的单个 chunk，目前就是字符串 */
export type StreamChunk = string

// ─── Logger ───────────────────────────────────────────────────────────────────

export interface Logger {
  info(msgOrObj: string | Record<string, unknown>, msg?: string): void
  warn(msgOrObj: string | Record<string, unknown>, msg?: string): void
  error(msgOrObj: string | Record<string, unknown>, msg?: string): void
  debug(msgOrObj: string | Record<string, unknown>, msg?: string): void
}
