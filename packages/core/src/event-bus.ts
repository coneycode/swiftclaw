/**
 * EventBus — 类型安全的事件总线
 *
 * 设计原则：
 * - 泛型 TEventMap 保证事件名 → payload 类型完全对应
 * - emit 是同步触发，handler 可以是 async（不等待结果）
 * - 单个 handler 抛错不影响其他 handler（try/catch 隔离）
 * - once 触发一次后自动 off
 * - 不继承 Node.js EventEmitter，避免泛型类型丢失
 */

export type Handler<T> = (payload: T) => void | Promise<void>

export class EventBus<TEventMap extends object> {
  private handlers = new Map<keyof TEventMap, Set<Handler<unknown>>>()

  on<E extends keyof TEventMap>(event: E, handler: Handler<TEventMap[E]>): void {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler as Handler<unknown>)
  }

  off<E extends keyof TEventMap>(event: E, handler: Handler<TEventMap[E]>): void {
    this.handlers.get(event)?.delete(handler as Handler<unknown>)
  }

  once<E extends keyof TEventMap>(event: E, handler: Handler<TEventMap[E]>): void {
    const wrapper: Handler<TEventMap[E]> = (payload) => {
      this.off(event, wrapper)
      return handler(payload)
    }
    this.on(event, wrapper)
  }

  emit<E extends keyof TEventMap>(event: E, payload: TEventMap[E]): void {
    const set = this.handlers.get(event)
    if (!set) return

    for (const handler of set) {
      try {
        const result = handler(payload)
        // async handler：静默处理 rejection，不让它扩散
        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            console.error(`[EventBus] Unhandled error in handler for event "${String(event)}":`, err)
          })
        }
      } catch (err) {
        // sync handler 抛错：记录但不影响其他 handler
        console.error(`[EventBus] Unhandled error in handler for event "${String(event)}":`, err)
      }
    }
  }

  /** 返回某事件当前注册的 handler 数量（测试用） */
  listenerCount<E extends keyof TEventMap>(event: E): number {
    return this.handlers.get(event)?.size ?? 0
  }

  /** 清除所有监听器（测试用） */
  removeAllListeners(): void {
    this.handlers.clear()
  }
}
