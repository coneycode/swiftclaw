import type { EventMap, Memory, Logger } from './types.js'
import type { EventBus, Handler } from './event-bus.js'
import type { ProviderRegistry } from './provider.js'

// ─── AppContext ───────────────────────────────────────────────────────────────

/**
 * AppContext — 插件与核心交互的唯一接口
 * Plugin 通过 ctx 访问事件总线、记忆系统、Provider 注册表和日志
 */
export interface AppContext {
  emit<E extends keyof EventMap>(event: E, payload: EventMap[E]): void
  on<E extends keyof EventMap>(event: E, handler: Handler<EventMap[E]>): void
  off<E extends keyof EventMap>(event: E, handler: Handler<EventMap[E]>): void
  memory: Memory
  providers: ProviderRegistry
  logger: Logger
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

/**
 * Plugin — SwiftClaw 的扩展单元（粗粒度）
 *
 * 每个 Plugin 是一个完整的功能模块（如渠道、工具包等）。
 * register() 在 app.start() 时被调用，Plugin 通过 ctx 注册事件监听。
 * stop() 在 app.stop() 时被调用，用于清理资源（关闭 HTTP 服务、断开连接等）。
 */
export interface Plugin {
  readonly name: string
  register(ctx: AppContext): void | Promise<void>
  stop?(): void | Promise<void>
}

// ─── AppContextImpl ───────────────────────────────────────────────────────────

/**
 * AppContext 的具体实现，由 SwiftClaw 主类创建并传给 Plugin
 */
export class AppContextImpl implements AppContext {
  constructor(
    private readonly bus: EventBus<EventMap>,
    public readonly memory: Memory,
    public readonly providers: ProviderRegistry,
    public readonly logger: Logger,
  ) {}

  emit<E extends keyof EventMap>(event: E, payload: EventMap[E]): void {
    this.bus.emit(event, payload)
  }

  on<E extends keyof EventMap>(event: E, handler: Handler<EventMap[E]>): void {
    this.bus.on(event, handler)
  }

  off<E extends keyof EventMap>(event: E, handler: Handler<EventMap[E]>): void {
    this.bus.off(event, handler)
  }
}
