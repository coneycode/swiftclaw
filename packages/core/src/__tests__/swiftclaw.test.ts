import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { SwiftClaw } from '../swiftclaw.js'
import { FileMemory } from '../memory.js'
import type { AppContext, Plugin } from '../plugin.js'

// Mock pino logger to prevent noise in test output
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'swiftclaw-app-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('SwiftClaw construction', () => {
  it('creates with defaults (FileMemory, pino logger)', () => {
    const app = new SwiftClaw({ memoryDir: tmpDir })
    expect(app).toBeInstanceOf(SwiftClaw)
    expect(app.memory).toBeInstanceOf(FileMemory)
    expect(app.providers).toBeDefined()
    expect(app.logger).toBeDefined()
  })

  it('accepts custom memory implementation', () => {
    const customMemory = new FileMemory(tmpDir)
    const app = new SwiftClaw({ memory: customMemory })
    expect(app.memory).toBe(customMemory)
  })
})

describe('SwiftClaw.registerProvider', () => {
  it('registers a provider and is chainable', () => {
    const app = new SwiftClaw({ memoryDir: tmpDir })
    const mockProvider = { languageModel: vi.fn() }
    const returned = app.registerProvider('test', mockProvider)
    expect(returned).toBe(app) // chainable
    expect(app.providers.hasProvider('test')).toBe(true)
  })

  it('supports chaining multiple providers', () => {
    const app = new SwiftClaw({ memoryDir: tmpDir })
    app
      .registerProvider('provider-a', { languageModel: vi.fn() })
      .registerProvider('provider-b', { languageModel: vi.fn() })
    expect(app.providers.hasProvider('provider-a')).toBe(true)
    expect(app.providers.hasProvider('provider-b')).toBe(true)
  })
})

describe('SwiftClaw.use (plugin registration)', () => {
  it('accepts a plugin without starting', () => {
    const app = new SwiftClaw({ memoryDir: tmpDir })
    const plugin: Plugin = { name: 'test-plugin', register: vi.fn() }
    const returned = app.use(plugin)
    expect(returned).toBe(app) // chainable
  })

  it('calls plugin.register() when app.start() is called', async () => {
    const app = new SwiftClaw({ memoryDir: tmpDir })
    const registerFn = vi.fn()
    const plugin: Plugin = { name: 'my-plugin', register: registerFn }
    app.use(plugin)
    await app.start()
    expect(registerFn).toHaveBeenCalledOnce()
    // register is called with AppContext
    const ctx = registerFn.mock.calls[0]?.[0] as AppContext
    expect(ctx).toBeDefined()
    expect(typeof ctx.emit).toBe('function')
    expect(typeof ctx.on).toBe('function')
    expect(ctx.memory).toBeDefined()
    expect(ctx.providers).toBeDefined()
    expect(ctx.logger).toBeDefined()
    await app.stop()
  })

  it('calls plugin.stop() when app.stop() is called', async () => {
    const app = new SwiftClaw({ memoryDir: tmpDir })
    const stopFn = vi.fn()
    const plugin: Plugin = { name: 'stoppable-plugin', register: vi.fn(), stop: stopFn }
    app.use(plugin)
    await app.start()
    await app.stop()
    expect(stopFn).toHaveBeenCalledOnce()
  })

  it('calls plugins in order', async () => {
    const app = new SwiftClaw({ memoryDir: tmpDir })
    const order: string[] = []
    const pluginA: Plugin = { name: 'a', register: vi.fn(() => { order.push('a') }) }
    const pluginB: Plugin = { name: 'b', register: vi.fn(() => { order.push('b') }) }
    app.use(pluginA).use(pluginB)
    await app.start()
    expect(order).toEqual(['a', 'b'])
    await app.stop()
  })
})

describe('SwiftClaw.start / stop', () => {
  it('warns if started twice', async () => {
    const app = new SwiftClaw({ memoryDir: tmpDir })
    await app.start()
    // Second start should warn but not throw
    await expect(app.start()).resolves.toBeUndefined()
    await app.stop()
  })
})

describe('SwiftClaw.createAgent', () => {
  it('creates an Agent with the app providers and memory', () => {
    const app = new SwiftClaw({ memoryDir: tmpDir })
    app.registerProvider('mock', { languageModel: vi.fn() })
    const agent = app.createAgent({ id: 'my-agent', model: 'mock/test-model' })
    expect(agent).toBeDefined()
    expect(agent.config.id).toBe('my-agent')
    expect(agent.config.model).toBe('mock/test-model')
  })
})

describe('SwiftClaw event bus delegation', () => {
  it('emit + on routes events through the app', async () => {
    const app = new SwiftClaw({ memoryDir: tmpDir })
    const handler = vi.fn()
    app.on('agent.start', handler)
    app.emit('agent.start', { agentId: 'a1', threadId: 'thread-1' })
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith({ agentId: 'a1', threadId: 'thread-1' })
  })
})
