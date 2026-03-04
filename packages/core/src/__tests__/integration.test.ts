/**
 * Integration tests — end-to-end flow using real SwiftClaw with mocked AI SDK
 *
 * These tests verify that all components work together correctly:
 * SwiftClaw main class + ProviderRegistry + Agent + FileMemory + EventBus + Plugins
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { SwiftClaw } from '../swiftclaw.js'
import { FileMemory } from '../memory.js'
import { defineTool } from '../tool.js'
import { z } from 'zod'

// Mock AI SDK
vi.mock('ai', () => {
  const mockStreamText = vi.fn((_opts: unknown) => {
    async function* gen() {
      yield { type: 'text-delta', textDelta: 'Integration test response' }
    }
    return { fullStream: gen() }
  })
  const mockGenerateText = vi.fn(async (_opts: unknown) => ({
    text: 'Sub-agent integration response',
  }))
  const mockTool = vi.fn((def: Record<string, unknown>) => ({
    ...def,
    execute: def['execute'],
  }))
  return { streamText: mockStreamText, generateText: mockGenerateText, tool: mockTool }
})

// Mock pino logger
vi.mock('pino', () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'swiftclaw-int-'))
  vi.clearAllMocks()
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ─── Full flow: SwiftClaw → Agent → Memory → Reply ────────────────────────────

describe('Integration: basic agent conversation', () => {
  it('message is stored in memory and reply is returned', async () => {
    const memory = new FileMemory(tmpDir)
    const app = new SwiftClaw({ memory })
    app.registerProvider('mock', { languageModel: vi.fn().mockReturnValue({ id: 'mock-model' }) })

    const agent = app.createAgent({
      id: 'integration-agent',
      model: 'mock/test-model',
      instructions: 'You are a test assistant.',
    })

    await app.start()

    const reply = await agent.run('integration-thread-1', 'Hello, integration!')
    expect(reply).toBe('Integration test response')

    // Verify memory was updated
    const history = await memory.getHistory('integration-thread-1')
    expect(history).toHaveLength(2)
    expect(history[0]!.role).toBe('user')
    expect(history[0]!.content).toBe('Hello, integration!')
    expect(history[1]!.role).toBe('assistant')
    expect(history[1]!.content).toBe('Integration test response')

    await app.stop()
  })

  it('multi-turn conversation accumulates in memory', async () => {
    const memory = new FileMemory(tmpDir)
    const app = new SwiftClaw({ memory })
    app.registerProvider('mock', { languageModel: vi.fn().mockReturnValue({ id: 'mock' }) })

    const agent = app.createAgent({ id: 'multi-turn', model: 'mock/test-model' })
    await app.start()

    await agent.run('thread-mt', 'Turn 1')
    await agent.run('thread-mt', 'Turn 2')
    await agent.run('thread-mt', 'Turn 3')

    const history = await memory.getHistory('thread-mt')
    // 3 user + 3 assistant = 6 messages
    expect(history).toHaveLength(6)
    expect(history.filter(m => m.role === 'user')).toHaveLength(3)
    expect(history.filter(m => m.role === 'assistant')).toHaveLength(3)

    await app.stop()
  })
})

// ─── Integration: Plugin + EventBus ──────────────────────────────────────────

describe('Integration: plugin + event bus', () => {
  it('plugin receives AppContext and can emit events', async () => {
    const receivedEvents: unknown[] = []

    const app = new SwiftClaw({ memoryDir: tmpDir })
    app.on('message.received', (event) => {
      receivedEvents.push(event)
    })

    app.use({
      name: 'test-plugin',
      register: (ctx) => {
        // Plugin emits an event during registration
        ctx.emit('message.received', {
          channel: 'test',
          threadId: 'test-thread',
          userId: 'user-1',
          text: 'Plugin hello',
        })
      },
    })

    await app.start()
    expect(receivedEvents).toHaveLength(1)
    expect(receivedEvents[0]).toMatchObject({ channel: 'test', text: 'Plugin hello' })

    await app.stop()
  })

  it('message.reply event can be emitted and received', async () => {
    const replies: unknown[] = []
    const app = new SwiftClaw({ memoryDir: tmpDir })
    app.on('message.reply', (event) => { replies.push(event) })

    await app.start()

    app.emit('message.reply', {
      channel: 'feishu',
      threadId: 'feishu:oc_test',
      text: 'Hello back!',
    })

    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({ channel: 'feishu', text: 'Hello back!' })

    await app.stop()
  })
})

// ─── Integration: Agent with tools ───────────────────────────────────────────

describe('Integration: agent with tools', () => {
  it('tool is passed to AI SDK and is callable', async () => {
    const { streamText } = await import('ai')
    const app = new SwiftClaw({ memoryDir: tmpDir })
    app.registerProvider('mock', { languageModel: vi.fn().mockReturnValue({ id: 'mock' }) })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calcTool: any = defineTool({
      description: 'Calculate',
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }: { a: number; b: number }) => a + b,
    })

    const agent = app.createAgent({
      id: 'tool-int-agent',
      model: 'mock/test-model',
      tools: { calc: calcTool },
    })

    await app.start()
    await agent.run('tool-thread', 'Calculate something')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (streamText as any).mock.calls[0][0]
    expect(callArgs.tools).toBeDefined()
    expect(callArgs.tools).toHaveProperty('calc')

    await app.stop()
  })
})

// ─── Integration: Supervisor pattern ─────────────────────────────────────────

describe('Integration: supervisor + sub-agent', () => {
  it('supervisor has sub-agent tools registered', async () => {
    const { streamText } = await import('ai')
    const app = new SwiftClaw({ memoryDir: tmpDir })
    app.registerProvider('mock', { languageModel: vi.fn().mockReturnValue({ id: 'mock' }) })

    const subAgent = app.createAgent({
      id: 'sub',
      model: 'mock/sub',
      description: 'Handles sub tasks',
    })

    const supervisor = app.createAgent({
      id: 'supervisor',
      model: 'mock/supervisor',
      subAgents: { helper: subAgent },
    })

    await app.start()
    await supervisor.run('sup-thread', 'Delegate to helper')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (streamText as any).mock.calls[0][0]
    expect(callArgs.tools).toHaveProperty('helper')

    await app.stop()
  })
})

// ─── Integration: Provider Registry ──────────────────────────────────────────

describe('Integration: provider registry', () => {
  it('initProvidersFromEnv registers from env vars', () => {
    const originalAnthropicKey = process.env['ANTHROPIC_API_KEY']
    process.env['ANTHROPIC_API_KEY'] = 'test-key-123'

    const app = new SwiftClaw({ memoryDir: tmpDir })
    app.initProvidersFromEnv()
    expect(app.providers.hasProvider('anthropic')).toBe(true)

    // Restore
    if (originalAnthropicKey !== undefined) {
      process.env['ANTHROPIC_API_KEY'] = originalAnthropicKey
    } else {
      delete process.env['ANTHROPIC_API_KEY']
    }
  })
})
