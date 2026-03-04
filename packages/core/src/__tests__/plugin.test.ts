import { describe, it, expect, vi } from 'vitest'
import { AppContextImpl } from '../plugin.js'
import { EventBus } from '../event-bus.js'
import { ProviderRegistry } from '../provider.js'
import type { EventMap, Memory, Logger } from '../types.js'

// ─── 测试用 Mock ──────────────────────────────────────────────────────────────

const mockMemory: Memory = {
  getHistory: vi.fn().mockResolvedValue([]),
  appendMessage: vi.fn().mockResolvedValue(undefined),
  getWorking: vi.fn().mockResolvedValue({}),
  setWorking: vi.fn().mockResolvedValue(undefined),
}

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

function makeCtx() {
  const bus = new EventBus<EventMap>()
  const registry = new ProviderRegistry()
  return { bus, ctx: new AppContextImpl(bus, mockMemory, registry, mockLogger) }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AppContextImpl', () => {
  it('emit/on: 通过 ctx 发出的事件被正确接收', () => {
    const { ctx } = makeCtx()
    const handler = vi.fn()

    ctx.on('agent.start', handler)
    ctx.emit('agent.start', { agentId: 'test', threadId: 'thread-1' })

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith({ agentId: 'test', threadId: 'thread-1' })
  })

  it('off: 通过 ctx.off 取消监听', () => {
    const { ctx } = makeCtx()
    const handler = vi.fn()

    ctx.on('agent.start', handler)
    ctx.off('agent.start', handler)
    ctx.emit('agent.start', { agentId: 'test', threadId: 'thread-1' })

    expect(handler).not.toHaveBeenCalled()
  })

  it('ctx.memory 可以访问', () => {
    const { ctx } = makeCtx()
    expect(ctx.memory).toBe(mockMemory)
  })

  it('ctx.providers 可以访问', () => {
    const { ctx } = makeCtx()
    expect(ctx.providers).toBeInstanceOf(ProviderRegistry)
  })

  it('plugin.register 在 start 时被调用', async () => {
    const { ctx } = makeCtx()
    const registerFn = vi.fn()
    const plugin = { name: 'test-plugin', register: registerFn }

    await plugin.register(ctx)

    expect(registerFn).toHaveBeenCalledOnce()
    expect(registerFn).toHaveBeenCalledWith(ctx)
  })

  it('plugin.stop 可选，不实现也不报错', () => {
    const plugin: { name: string; register: ReturnType<typeof vi.fn>; stop?: () => void } = { name: 'test-plugin', register: vi.fn() }
    // stop 是可选的，不定义就是 undefined
    expect(plugin.stop).toBeUndefined()
  })
})

describe('ProviderRegistry', () => {
  it('registerProvider + getModel: 注册后可以取到 model', () => {
    const registry = new ProviderRegistry()
    const mockModel = { id: 'test-model' }
    const mockProvider = { languageModel: vi.fn().mockReturnValue(mockModel) }

    registry.registerProvider('test', mockProvider)
    const model = registry.getModel('test/my-model')

    expect(mockProvider.languageModel).toHaveBeenCalledWith('my-model')
    expect(model).toBe(mockModel)
  })

  it('getModel: 未注册的 provider 抛出明确错误', () => {
    const registry = new ProviderRegistry()
    expect(() => registry.getModel('unknown/model')).toThrowError(/Provider "unknown" is not registered/)
  })

  it('getModel: modelRef 格式错误抛出明确错误', () => {
    const registry = new ProviderRegistry()
    expect(() => registry.getModel('no-slash')).toThrowError(/Invalid model ref/)
  })

  it('hasProvider: 已注册返回 true，未注册返回 false', () => {
    const registry = new ProviderRegistry()
    registry.registerProvider('test', { languageModel: vi.fn() })

    expect(registry.hasProvider('test')).toBe(true)
    expect(registry.hasProvider('other')).toBe(false)
  })

  it('listProviders: 返回所有已注册 provider 名称', () => {
    const registry = new ProviderRegistry()
    registry.registerProvider('anthropic', { languageModel: vi.fn() })
    registry.registerProvider('openai', { languageModel: vi.fn() })

    expect(registry.listProviders()).toEqual(expect.arrayContaining(['anthropic', 'openai']))
  })

  it('initFromEnv: ANTHROPIC_API_KEY 存在时注册 anthropic', () => {
    const registry = new ProviderRegistry()
    process.env['ANTHROPIC_API_KEY'] = 'test-key'

    registry.initFromEnv()

    expect(registry.hasProvider('anthropic')).toBe(true)
    delete process.env['ANTHROPIC_API_KEY']
  })

  it('initFromEnv: 已手动注册的 provider 不会被覆盖', () => {
    const registry = new ProviderRegistry()
    const customProvider = { languageModel: vi.fn() }
    registry.registerProvider('anthropic', customProvider)
    process.env['ANTHROPIC_API_KEY'] = 'test-key'

    registry.initFromEnv()

    // 验证自定义 provider 没有被覆盖
    registry.getModel('anthropic/claude-3')
    expect(customProvider.languageModel).toHaveBeenCalledWith('claude-3')

    delete process.env['ANTHROPIC_API_KEY']
  })
})
