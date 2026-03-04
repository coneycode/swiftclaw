import { describe, it, expect, vi } from 'vitest'
import { EventBus } from '../event-bus.js'
import type { EventMap } from '../types.js'

describe('EventBus', () => {
  it('on/emit: 注册 handler 后 emit 正确触发', () => {
    const bus = new EventBus<EventMap>()
    const handler = vi.fn()

    bus.on('agent.start', handler)
    bus.emit('agent.start', { agentId: 'test', threadId: 'thread-1' })

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith({ agentId: 'test', threadId: 'thread-1' })
  })

  it('off: off 之后 emit 不再触发', () => {
    const bus = new EventBus<EventMap>()
    const handler = vi.fn()

    bus.on('agent.start', handler)
    bus.off('agent.start', handler)
    bus.emit('agent.start', { agentId: 'test', threadId: 'thread-1' })

    expect(handler).not.toHaveBeenCalled()
  })

  it('once: 只触发一次，第二次 emit 不触发', () => {
    const bus = new EventBus<EventMap>()
    const handler = vi.fn()

    bus.once('agent.start', handler)
    bus.emit('agent.start', { agentId: 'test', threadId: 'thread-1' })
    bus.emit('agent.start', { agentId: 'test', threadId: 'thread-2' })

    expect(handler).toHaveBeenCalledOnce()
  })

  it('once: 触发后自动取消注册', () => {
    const bus = new EventBus<EventMap>()
    const handler = vi.fn()

    bus.once('agent.start', handler)
    expect(bus.listenerCount('agent.start')).toBe(1)

    bus.emit('agent.start', { agentId: 'test', threadId: 'thread-1' })
    expect(bus.listenerCount('agent.start')).toBe(0)
  })

  it('错误隔离: handler A 抛错，handler B 仍然执行', () => {
    const bus = new EventBus<EventMap>()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const handlerA = vi.fn().mockImplementation(() => { throw new Error('handler A error') })
    const handlerB = vi.fn()

    bus.on('agent.start', handlerA)
    bus.on('agent.start', handlerB)
    bus.emit('agent.start', { agentId: 'test', threadId: 'thread-1' })

    expect(handlerA).toHaveBeenCalledOnce()
    expect(handlerB).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('async handler 错误隔离: 不阻塞其他 handler', async () => {
    const bus = new EventBus<EventMap>()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const asyncErrorHandler = vi.fn().mockRejectedValue(new Error('async error'))
    const syncHandler = vi.fn()

    bus.on('agent.start', asyncErrorHandler)
    bus.on('agent.start', syncHandler)
    bus.emit('agent.start', { agentId: 'test', threadId: 'thread-1' })

    // 等待 microtask queue 处理 async rejection
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(syncHandler).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('多个 handler: 全部触发', () => {
    const bus = new EventBus<EventMap>()
    const h1 = vi.fn()
    const h2 = vi.fn()
    const h3 = vi.fn()

    bus.on('agent.start', h1)
    bus.on('agent.start', h2)
    bus.on('agent.start', h3)
    bus.emit('agent.start', { agentId: 'test', threadId: 'thread-1' })

    expect(h1).toHaveBeenCalledOnce()
    expect(h2).toHaveBeenCalledOnce()
    expect(h3).toHaveBeenCalledOnce()
  })

  it('listenerCount: 返回正确数量', () => {
    const bus = new EventBus<EventMap>()
    const h1 = vi.fn()
    const h2 = vi.fn()

    expect(bus.listenerCount('agent.start')).toBe(0)
    bus.on('agent.start', h1)
    expect(bus.listenerCount('agent.start')).toBe(1)
    bus.on('agent.start', h2)
    expect(bus.listenerCount('agent.start')).toBe(2)
    bus.off('agent.start', h1)
    expect(bus.listenerCount('agent.start')).toBe(1)
  })

  it('removeAllListeners: 清除所有监听器', () => {
    const bus = new EventBus<EventMap>()
    const handler = vi.fn()

    bus.on('agent.start', handler)
    bus.on('agent.done', handler)
    bus.removeAllListeners()

    bus.emit('agent.start', { agentId: 'test', threadId: 'thread-1' })
    bus.emit('agent.done', { agentId: 'test', threadId: 'thread-1' })

    expect(handler).not.toHaveBeenCalled()
  })

  it('不同事件互不干扰', () => {
    const bus = new EventBus<EventMap>()
    const startHandler = vi.fn()
    const doneHandler = vi.fn()

    bus.on('agent.start', startHandler)
    bus.on('agent.done', doneHandler)

    bus.emit('agent.start', { agentId: 'test', threadId: 'thread-1' })

    expect(startHandler).toHaveBeenCalledOnce()
    expect(doneHandler).not.toHaveBeenCalled()
  })
})
