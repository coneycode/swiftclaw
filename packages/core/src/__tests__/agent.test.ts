import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { Agent } from '../agent.js'
import { FileMemory } from '../memory.js'
import { ProviderRegistry } from '../provider.js'
import { defineTool } from '../tool.js'
import type { SwiftClawTool } from '../types.js'
import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// ─── Mock Vercel AI SDK ────────────────────────────────────────────────────────

vi.mock('ai', () => {
  // Helper: mock streamText returns an object with fullStream (matches updated agent.ts behavior)
  const mockStreamText = vi.fn((_opts: unknown) => {
    async function* gen() {
      yield { type: 'text-delta', textDelta: 'Hello ' }
      yield { type: 'text-delta', textDelta: 'world!' }
    }
    return { fullStream: gen() }
  })

  // Helper: mock generateText returns a text string
  const mockGenerateText = vi.fn(async (_opts: unknown) => ({
    text: 'Sub-agent response',
  }))

  // Mock tool() — just returns a structured object with the same shape
  const mockTool = vi.fn((def: Record<string, unknown>) => ({
    ...def,
    // ensure execute is present for tool map checks
    execute: def['execute'],
  }))

  return {
    streamText: mockStreamText,
    generateText: mockGenerateText,
    tool: mockTool,
  }
})

// ─── Test setup ───────────────────────────────────────────────────────────────

let tmpDir: string
let memory: FileMemory
let providers: ProviderRegistry

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'swiftclaw-agent-'))
  memory = new FileMemory(tmpDir)
  providers = new ProviderRegistry()
  // Register a mock provider
  providers.registerProvider('mock', {
    languageModel: (_id: string) => ({ id: _id }),
  })

  // Reset mocks
  vi.clearAllMocks()
})

async function cleanupTmpDir() {
  await fs.rm(tmpDir, { recursive: true, force: true })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Agent.run (non-streaming)', () => {
  it('returns full text from streamText', async () => {
    const agent = new Agent(
      { id: 'test-agent', model: 'mock/test-model' },
      providers,
      memory,
    )
    const result = await agent.run('thread-1', 'Hello!')
    expect(result).toBe('Hello world!')
    await cleanupTmpDir()
  })

  it('writes user + assistant messages to memory', async () => {
    const agent = new Agent(
      { id: 'test-agent', model: 'mock/test-model' },
      providers,
      memory,
    )
    await agent.run('thread-2', 'Hi there')
    const history = await memory.getHistory('thread-2')
    expect(history).toHaveLength(2)
    expect(history[0]!.role).toBe('user')
    expect(history[0]!.content).toBe('Hi there')
    expect(history[1]!.role).toBe('assistant')
    expect(history[1]!.content).toBe('Hello world!')
    await cleanupTmpDir()
  })

  it('passes history from memory to streamText', async () => {
    const { streamText } = await import('ai')
    const agent = new Agent(
      { id: 'test-agent', model: 'mock/test-model' },
      providers,
      memory,
    )
    // Pre-populate history
    await memory.appendMessage('thread-3', { role: 'user', content: 'Previous message' })
    await memory.appendMessage('thread-3', { role: 'assistant', content: 'Previous reply' })

    await agent.run('thread-3', 'New message')

    expect(streamText).toHaveBeenCalledOnce()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (streamText as any).mock.calls[0][0]
    // Should include 2 previous messages + new user message = 3 messages
    expect(callArgs.messages).toHaveLength(3)
    expect(callArgs.messages[2].content).toBe('New message')
    await cleanupTmpDir()
  })
})

describe('Agent.stream (streaming)', () => {
  it('yields chunks', async () => {
    const agent = new Agent(
      { id: 'stream-agent', model: 'mock/test-model' },
      providers,
      memory,
    )
    const chunks: string[] = []
    for await (const chunk of agent.stream('thread-s', 'Hello')) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(['Hello ', 'world!'])
    await cleanupTmpDir()
  })
})

describe('Agent system instructions', () => {
  it('passes string instructions as system', async () => {
    const { streamText } = await import('ai')
    const agent = new Agent(
      { id: 'instruct-agent', model: 'mock/test-model', instructions: 'You are helpful.' },
      providers,
      memory,
    )
    await agent.run('thread-i', 'Hi')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (streamText as any).mock.calls[0][0]
    expect(callArgs.system).toBe('You are helpful.')
    await cleanupTmpDir()
  })

  it('passes async function instructions as system', async () => {
    const { streamText } = await import('ai')
    const agent = new Agent(
      {
        id: 'async-instruct-agent',
        model: 'mock/test-model',
        instructions: async () => 'Dynamic instructions',
      },
      providers,
      memory,
    )
    await agent.run('thread-ai', 'Hi')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (streamText as any).mock.calls[0][0]
    expect(callArgs.system).toBe('Dynamic instructions')
    await cleanupTmpDir()
  })
})

describe('Agent with tools', () => {
  it('passes tools to streamText when tools are configured', async () => {
    const { streamText } = await import('ai')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const echoTool: SwiftClawTool<any, any> = defineTool({
      description: 'Echo input',
      parameters: z.object({ text: z.string() }),
      execute: async ({ text }: { text: string }) => text,
    })
    const agent = new Agent(
      { id: 'tool-agent', model: 'mock/test-model', tools: { echo: echoTool } },
      providers,
      memory,
    )
    await agent.run('thread-t', 'Use echo')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (streamText as any).mock.calls[0][0]
    expect(callArgs.tools).toBeDefined()
    expect(callArgs.tools).toHaveProperty('echo')
    await cleanupTmpDir()
  })

  it('does not pass tools when no tools configured', async () => {
    const { streamText } = await import('ai')
    const agent = new Agent(
      { id: 'no-tool-agent', model: 'mock/test-model' },
      providers,
      memory,
    )
    await agent.run('thread-nt', 'Hello')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (streamText as any).mock.calls[0][0]
    expect(callArgs.tools).toBeUndefined()
    await cleanupTmpDir()
  })
})

describe('Agent Supervisor pattern', () => {
  it('wraps sub-agents as tools and passes to streamText', async () => {
    const { streamText } = await import('ai')

    const subAgent = new Agent(
      {
        id: 'sub-agent',
        model: 'mock/sub-model',
        description: 'Handles sub-tasks',
      },
      providers,
      memory,
    )

    const supervisor = new Agent(
      {
        id: 'supervisor',
        model: 'mock/supervisor-model',
        subAgents: { helper: subAgent },
      },
      providers,
      memory,
    )

    await supervisor.run('thread-sup', 'Delegate to helper')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (streamText as any).mock.calls[0][0]
    expect(callArgs.tools).toBeDefined()
    expect(callArgs.tools).toHaveProperty('helper')
    await cleanupTmpDir()
  })
})

describe('Agent.runAsSubAgent', () => {
  it('uses generateText (not streamText)', async () => {
    const { generateText, streamText } = await import('ai')
    const agent = new Agent(
      { id: 'sub', model: 'mock/test-model', description: 'Sub agent' },
      providers,
      memory,
    )
    const result = await agent.runAsSubAgent('thread-sub', 'Do this task')
    expect(result).toBe('Sub-agent response')
    expect(generateText).toHaveBeenCalledOnce()
    expect(streamText).not.toHaveBeenCalled()
    await cleanupTmpDir()
  })

  it('writes messages to sub thread', async () => {
    const agent = new Agent(
      { id: 'sub2', model: 'mock/test-model' },
      providers,
      memory,
    )
    await agent.runAsSubAgent('thread-sub2', 'A task')
    const history = await memory.getHistory('thread-sub2')
    expect(history).toHaveLength(2)
    expect(history[0]!.role).toBe('user')
    expect(history[1]!.role).toBe('assistant')
    await cleanupTmpDir()
  })
})

describe('Agent maxSteps', () => {
  it('passes maxSteps to streamText (defaults to 10)', async () => {
    const { streamText } = await import('ai')
    const agent = new Agent(
      { id: 'steps-agent', model: 'mock/test-model' },
      providers,
      memory,
    )
    await agent.run('thread-ms', 'Go')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (streamText as any).mock.calls[0][0]
    expect(callArgs.maxSteps).toBe(10)
    await cleanupTmpDir()
  })

  it('respects custom maxSteps', async () => {
    const { streamText } = await import('ai')
    const agent = new Agent(
      { id: 'custom-steps', model: 'mock/test-model', maxSteps: 3 },
      providers,
      memory,
    )
    await agent.run('thread-cs', 'Go')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (streamText as any).mock.calls[0][0]
    expect(callArgs.maxSteps).toBe(3)
    await cleanupTmpDir()
  })
})
