import { tool } from 'ai'
import type { z } from 'zod'
import type { SwiftClawTool } from './types.js'

// ─── defineTool ───────────────────────────────────────────────────────────────

/**
 * defineTool — SwiftClaw Tool 定义工厂函数
 *
 * 通过 TypeScript 泛型推断提供完整的类型安全。
 * 调用方式:
 * ```typescript
 * const myTool = defineTool({
 *   description: '搜索网络',
 *   parameters: z.object({ query: z.string() }),
 *   execute: async ({ query }) => { return `result for ${query}` },
 * })
 * ```
 */
export function defineTool<TInput, TOutput>(
  tool: SwiftClawTool<TInput, TOutput>,
): SwiftClawTool<TInput, TOutput> {
  return tool
}

// ─── toAiSdkTool ──────────────────────────────────────────────────────────────

/**
 * toAiSdkTool — 将 SwiftClawTool 转换为 Vercel AI SDK 的 tool() 格式
 *
 * 用于将 SwiftClaw 工具注册到 Agent 的 streamText / generateText 调用中。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function toAiSdkTool<TInput>(swiftTool: SwiftClawTool<TInput, unknown>): any {
  return tool({
    description: swiftTool.description,
    parameters: swiftTool.parameters as z.ZodType,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: swiftTool.execute as (input: any) => Promise<unknown>,
  })
}

// ─── createToolMap ────────────────────────────────────────────────────────────

/**
 * createToolMap — 将 SwiftClawTool Map 批量转换为 AI SDK tool Map
 *
 * 用于将整个工具集传给 Agent 的 streamText / generateText:
 * ```typescript
 * await streamText({
 *   model: ...,
 *   tools: createToolMap(agent.config.tools ?? {}),
 * })
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createToolMap(tools: Record<string, SwiftClawTool>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(tools).map(([key, t]) => [key, toAiSdkTool(t)]),
  )
}
