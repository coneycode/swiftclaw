import { streamText, tool } from 'ai'
import { z } from 'zod'
import { FileMemory } from 'swiftclaw'
import type { LanguageModelV1 } from 'ai'
import { renderer } from './renderer.js'
import { allTools } from './tools/index.js'

// ─── AssistantAgent ───────────────────────────────────────────────────────────
//
// Wraps Vercel AI SDK streamText directly (instead of going through SwiftClaw
// Agent) so we have full visibility into tool calls and results in the terminal.
// Uses SwiftClaw FileMemory for persistent conversation history.

const SYSTEM_PROMPT = `You are a highly capable personal AI assistant running locally.

## Your capabilities
- **Code execution**: Write and run TypeScript, JavaScript, Python, or Bash code
- **File operations**: Read, write, and list files on the local filesystem
- **Shell commands**: Execute shell commands (git, npm, system tools, etc.)

## How to work
- When asked to write code, always verify it works by executing it
- Include proper test assertions or print statements to confirm correctness
- Show your reasoning briefly before taking action
- When executing code, write self-contained snippets that demonstrate the result clearly
- For file operations, use absolute paths or paths relative to the current working directory

## Style
- Be concise but thorough
- Show code in proper markdown code blocks
- After executing code, explain what the output means
- If something fails, diagnose and fix it automatically

Current working directory: ${process.cwd()}
`

export class AssistantAgent {
  private readonly model: LanguageModelV1
  private readonly memory: FileMemory
  private readonly agentId = 'assistant'

  constructor(model: LanguageModelV1, memoryDir: string) {
    this.model = model
    this.memory = new FileMemory(memoryDir)
  }

  // ─── Build AI SDK tools ─────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildTools(): Record<string, any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdkTools: Record<string, any> = {}

    for (const [name, swiftTool] of Object.entries(allTools)) {
      sdkTools[name] = tool({
        description: swiftTool.description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parameters: swiftTool.parameters as z.ZodType<any>,
        execute: async (args: unknown) => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return await (swiftTool.execute as (args: any) => Promise<unknown>)(args)
          } catch (err) {
            renderer.toolError(name, err)
            return { error: err instanceof Error ? err.message : String(err) }
          }
        },
      })
    }

    return sdkTools
  }

  // ─── Stream a response ──────────────────────────────────────────────────

  async *stream(threadId: string, userText: string): AsyncGenerator<void> {
    // 1. Save user message
    await this.memory.appendMessage(threadId, {
      role: 'user',
      content: userText,
      createdAt: Date.now(),
    })

    // 2. Load history
    const history = await this.memory.getHistory(threadId)

    // 3. Load working memory (background info)
    const working = await this.memory.getWorking(this.agentId)
    const workingStr = Object.keys(working).length > 0
      ? `\n\n## Your memory about me\n${JSON.stringify(working, null, 2)}`
      : ''

    // 4. Stream
    renderer.thinking()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (streamText as any)({
      model: this.model,
      system: SYSTEM_PROMPT + workingStr,
      messages: history.map(m => ({ role: m.role, content: m.content })),
      tools: this.buildTools(),
      maxSteps: 15,
    })

    let fullText = ''
    let firstChunk = true

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        if (firstChunk) {
          renderer.clearThinking()
          renderer.assistantPrefix()
          firstChunk = false
        }
        process.stdout.write(part.textDelta)
        fullText += part.textDelta
      } else if (part.type === 'tool-call') {
        if (firstChunk) {
          renderer.clearThinking()
          firstChunk = false
        }
        renderer.toolCall(part.toolName, part.args)
      } else if (part.type === 'tool-result') {
        renderer.toolResult(part.toolName, part.result)
        // After tool result, re-show assistant prefix if there'll be more text
        process.stdout.write(`\n${'\x1b[1m'}\x1b[36mAssistant\x1b[0m\x1b[1m: \x1b[0m`)
      }
      yield
    }

    if (firstChunk) {
      renderer.clearThinking()
    }

    renderer.assistantEnd()

    // 5. Save assistant reply
    if (fullText) {
      await this.memory.appendMessage(threadId, {
        role: 'assistant',
        content: fullText,
        createdAt: Date.now(),
      })
    }
  }

  // ─── Remember something explicitly ─────────────────────────────────────

  async remember(key: string, value: unknown): Promise<void> {
    const working = await this.memory.getWorking(this.agentId)
    working[key] = value
    await this.memory.setWorking(this.agentId, working)
  }

  async getWorking(): Promise<Record<string, unknown>> {
    return this.memory.getWorking(this.agentId)
  }
}
