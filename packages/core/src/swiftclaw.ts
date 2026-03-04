import pino from 'pino'
import { EventBus } from './event-bus.js'
import { AppContextImpl } from './plugin.js'
import { ProviderRegistry } from './provider.js'
import { FileMemory } from './memory.js'
import type { Plugin } from './plugin.js'
import type { EventMap, Memory, Logger, AgentConfig } from './types.js'
import { Agent } from './agent.js'

// ─── SwiftClawOptions ─────────────────────────────────────────────────────────

export interface SwiftClawOptions {
  /** 内存实现，不传则使用 FileMemory（默认目录 './memory'） */
  memory?: Memory
  /** 日志实现，不传则使用 pino 默认日志 */
  logger?: Logger
  /** 内存根目录（当使用默认 FileMemory 时有效），默认 './memory' */
  memoryDir?: string
}

// ─── SwiftClaw ────────────────────────────────────────────────────────────────

/**
 * SwiftClaw — 应用主类
 *
 * 用法:
 * ```typescript
 * const app = new SwiftClaw()
 * app.registerProvider('anthropic', createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY }))
 * app.use(myPlugin)
 * await app.start()
 *
 * const agent = app.createAgent({ id: 'my-agent', model: 'anthropic/claude-sonnet-4-5' })
 * const reply = await agent.run('thread-1', 'Hello!')
 *
 * await app.stop()
 * ```
 */
export class SwiftClaw {
  private readonly bus: EventBus<EventMap>
  readonly providers: ProviderRegistry
  readonly memory: Memory
  readonly logger: Logger
  private readonly plugins: Plugin[] = []
  private started = false

  constructor(options: SwiftClawOptions = {}) {
    this.bus = new EventBus<EventMap>()
    this.providers = new ProviderRegistry()
    this.logger = options.logger ?? pino({ name: 'swiftclaw' })
    this.memory = options.memory ?? new FileMemory(options.memoryDir ?? './memory')
  }

  // ─── Provider Management ──────────────────────────────────────────────────

  /**
   * 注册 LLM Provider
   * @param name Provider 名称（对应 'provider/model' 中的 provider 部分）
   * @param provider 实现 languageModel(id) 的对象
   */
  registerProvider(name: string, provider: { languageModel: (modelId: string) => unknown }): this {
    this.providers.registerProvider(name, provider)
    return this
  }

  /**
   * 从环境变量自动初始化内置 Provider（ANTHROPIC_API_KEY, OPENAI_API_KEY）
   */
  initProvidersFromEnv(): this {
    this.providers.initFromEnv()
    return this
  }

  // ─── Plugin Management ────────────────────────────────────────────────────

  /**
   * 注册一个 Plugin（渠道、工具包等）
   * @param plugin 实现 Plugin 接口的对象
   */
  use(plugin: Plugin): this {
    this.plugins.push(plugin)
    return this
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * 启动应用：依次调用所有 Plugin 的 register()
   */
  async start(): Promise<void> {
    if (this.started) {
      this.logger.warn('SwiftClaw is already started')
      return
    }
    const ctx = new AppContextImpl(this.bus, this.memory, this.providers, this.logger)
    for (const plugin of this.plugins) {
      await plugin.register(ctx)
      this.logger.info({ plugin: plugin.name }, 'Plugin registered')
    }
    this.started = true
    this.logger.info('SwiftClaw started')
  }

  /**
   * 停止应用：依次调用所有 Plugin 的 stop()（如果有）
   */
  async stop(): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.stop) {
        await plugin.stop()
        this.logger.info({ plugin: plugin.name }, 'Plugin stopped')
      }
    }
    this.started = false
    this.logger.info('SwiftClaw stopped')
  }

  // ─── Agent Factory ────────────────────────────────────────────────────────

  /**
   * 创建并返回一个 Agent 实例
   * @param config AgentConfig — 至少需要 id 和 model
   */
  createAgent(config: AgentConfig): Agent {
    return new Agent(config, this.providers, this.memory)
  }

  // ─── Event Bus (delegation) ───────────────────────────────────────────────

  /**
   * 发布事件到内部 EventBus
   */
  emit<E extends keyof EventMap>(event: E, payload: EventMap[E]): void {
    this.bus.emit(event, payload)
  }

  /**
   * 监听内部事件
   */
  on<E extends keyof EventMap>(event: E, handler: (payload: EventMap[E]) => void): void {
    this.bus.on(event, handler)
  }
}
