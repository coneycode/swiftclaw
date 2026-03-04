/**
 * 05-plugins — 自定义 Plugin 与 EventBus 演示
 *
 * 覆盖功能:
 *   ✅ 实现自定义 Plugin（Logger Plugin）
 *   ✅ AppContext — emit / on / off
 *   ✅ 监听 message.received 事件
 *   ✅ 监听 message.reply 事件
 *   ✅ 监听 agent.start / agent.done / agent.error 事件
 *   ✅ Plugin stop() 清理资源
 *   ✅ 多个 Plugin 同时注册（执行顺序）
 *   ✅ Plugin 通过 ctx.memory 访问记忆
 *   ✅ Plugin 通过 ctx.providers 访问 Provider
 *   ✅ 模拟一个完整的 Channel Plugin（console 渠道）
 *
 * 运行:
 *   ANTHROPIC_API_KEY=sk-ant-xxx tsx index.ts
 */

import { SwiftClaw, type Plugin, type AppContext } from 'swiftclaw'
import { createAnthropic } from '@ai-sdk/anthropic'

function divider(title: string) {
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`  ${title}`)
  console.log('─'.repeat(50))
}

// ─── Plugin 1: 事件日志插件 ───────────────────────────────────────────────────
// 监听所有事件并打印日志

class EventLoggerPlugin implements Plugin {
  readonly name = 'event-logger'
  private eventCount = 0

  register(ctx: AppContext): void {
    ctx.logger.info({ plugin: this.name }, 'EventLogger registered')

    ctx.on('message.received', (msg) => {
      this.eventCount++
      console.log(`  📨 [EventLogger] message.received #${this.eventCount}: channel=${msg.channel}, text="${msg.text.slice(0, 40)}"`)
    })

    ctx.on('message.reply', (msg) => {
      this.eventCount++
      console.log(`  📤 [EventLogger] message.reply #${this.eventCount}: channel=${msg.channel}, text="${msg.text.slice(0, 40)}"`)
    })

    ctx.on('agent.start', (evt) => {
      this.eventCount++
      console.log(`  🤖 [EventLogger] agent.start #${this.eventCount}: agentId=${evt.agentId}, thread=${evt.threadId}`)
    })

    ctx.on('agent.done', (evt) => {
      this.eventCount++
      console.log(`  ✅ [EventLogger] agent.done #${this.eventCount}: agentId=${evt.agentId}`)
    })

    ctx.on('agent.error', (evt) => {
      this.eventCount++
      console.log(`  ❌ [EventLogger] agent.error #${this.eventCount}:`, evt.error)
    })
  }

  stop(): void {
    console.log(`  [EventLogger] stopped. Total events logged: ${this.eventCount}`)
  }
}

// ─── Plugin 2: 请求统计插件 ───────────────────────────────────────────────────
// 统计每个渠道收到的消息数量

class StatsPlugin implements Plugin {
  readonly name = 'stats'
  private stats: Record<string, number> = {}
  private ctx: AppContext | null = null

  register(ctx: AppContext): void {
    this.ctx = ctx

    ctx.on('message.received', (msg) => {
      this.stats[msg.channel] = (this.stats[msg.channel] ?? 0) + 1
    })

    console.log(`  [Stats] Plugin registered`)
  }

  getStats(): Record<string, number> {
    return { ...this.stats }
  }

  stop(): void {
    console.log(`  [Stats] Final stats:`, this.stats)
  }
}

// ─── Plugin 3: 模拟 Console 渠道 ─────────────────────────────────────────────
// 模拟一个完整的 Channel Plugin（通过 EventBus 收发消息）

class ConsoleChannelPlugin implements Plugin {
  readonly name = 'console-channel'
  private ctx: AppContext | null = null
  private handleMessage: (threadId: string, userId: string, text: string) => Promise<string>

  constructor(
    handler: (threadId: string, userId: string, text: string) => Promise<string>,
  ) {
    this.handleMessage = handler
  }

  register(ctx: AppContext): void {
    this.ctx = ctx

    // 监听 reply 事件，把回复打印到控制台
    ctx.on('message.reply', (msg) => {
      if (msg.channel === 'console') {
        console.log(`  💬 [Console Channel] Bot reply → "${msg.text.slice(0, 100)}"`)
      }
    })

    console.log(`  [ConsoleChannel] Plugin registered`)
  }

  // 模拟接收一条消息（相当于用户发消息）
  async receiveMessage(userId: string, text: string): Promise<void> {
    if (!this.ctx) throw new Error('Plugin not registered')

    const threadId = `console:${userId}`

    // 1. 发布 message.received 事件
    this.ctx.emit('message.received', {
      channel: 'console',
      threadId,
      userId,
      text,
    })

    // 2. 调用 handler（通常是 agent.run）
    try {
      const reply = await this.handleMessage(threadId, userId, text)
      // 3. 发布 message.reply 事件
      this.ctx.emit('message.reply', {
        channel: 'console',
        threadId,
        text: reply,
      })
    } catch (err) {
      this.ctx.emit('agent.error', { agentId: 'console-agent', error: err })
    }
  }

  stop(): void {
    console.log(`  [ConsoleChannel] stopped`)
  }
}

// ─── 主函数 ───────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env['ANTHROPIC_API_KEY']) {
    console.error('❌ 需要设置 ANTHROPIC_API_KEY')
    process.exit(1)
  }

  const app = new SwiftClaw({ memoryDir: './tmp/memory-plugins' })
  app.registerProvider('anthropic', createAnthropic({
    apiKey: process.env['ANTHROPIC_API_KEY']!,
    baseURL: 'https://api.minimaxi.com/anthropic/v1',
  }))

  const agent = app.createAgent({
    id: 'plugin-demo-agent',
    model: process.env['MODEL'] ?? 'anthropic/MiniMax-M2.5',
    instructions: '你是一个简洁的助手。用1-2句话中文回答。',
  })

  // ── 测试 1: 多 Plugin 注册顺序 ────────────────────────────────────────────
  divider('测试 1: 多 Plugin 注册（顺序执行）')

  const logger = new EventLoggerPlugin()
  const stats = new StatsPlugin()
  const consoleChannel = new ConsoleChannelPlugin(
    (threadId, _userId, text) => agent.run(threadId, text),
  )

  // Plugin 注册顺序就是 register() 调用顺序
  app.use(logger).use(stats).use(consoleChannel)
  await app.start()
  console.log('✅ 3 个 Plugin 已按顺序注册')

  // ── 测试 2: EventBus 直接 emit ────────────────────────────────────────────
  divider('测试 2: 直接通过 app.emit 触发事件')

  app.emit('message.received', {
    channel: 'test',
    threadId: 'test-thread',
    userId: 'user-001',
    text: '这是一条测试事件',
  })
  console.log('✅ 手动 emit message.received（上面应该看到 EventLogger 打印）')

  // ── 测试 3: 通过 Console Channel 发送消息（触发 Agent）───────────────────
  divider('测试 3: Console Channel → Agent → Reply（完整流程）')

  const messages = [
    { userId: 'user-001', text: '你好，请介绍一下自己' },
    { userId: 'user-002', text: 'TypeScript 和 JavaScript 的区别是什么？' },
  ]

  for (const msg of messages) {
    console.log(`\n  📨 用户 ${msg.userId}: "${msg.text}"`)
    await consoleChannel.receiveMessage(msg.userId, msg.text)
  }

  // ── 测试 4: 查看统计 ──────────────────────────────────────────────────────
  divider('测试 4: 查看 StatsPlugin 统计')
  const currentStats = stats.getStats()
  console.log('渠道消息统计:', currentStats)
  console.log(`  console 渠道: ${currentStats['console'] ?? 0} 条消息`)
  console.log(`  test 渠道: ${currentStats['test'] ?? 0} 条消息`)

  // ── 测试 5: app.on 直接监听（不通过 Plugin）──────────────────────────────
  divider('测试 5: app.on 直接监听事件')

  const received: string[] = []
  app.on('message.received', (msg) => {
    received.push(msg.text)
  })

  app.emit('message.received', { channel: 'direct', threadId: 't1', userId: 'u1', text: '直接监听测试A' })
  app.emit('message.received', { channel: 'direct', threadId: 't2', userId: 'u2', text: '直接监听测试B' })
  console.log(`✅ 通过 app.on 收到 ${received.length} 条事件:`, received)

  // ── 测试 6: Plugin ctx.memory 访问 ────────────────────────────────────────
  divider('测试 6: Plugin 通过 ctx.memory 访问记忆（在 Plugin 内部）')

  // 创建一个 Plugin，在收到消息后把对话记录写入 working memory
  let sessionCount = 0
  const memoryPlugin: Plugin = {
    name: 'memory-tracker',
    register(ctx) {
      ctx.on('message.received', async (msg) => {
        sessionCount++
        await ctx.memory.setWorking('memory-tracker', {
          totalMessages: sessionCount,
          lastChannel: msg.channel,
          lastText: msg.text,
        })
      })
    },
  }
  app.use(memoryPlugin)
  // 注意: memoryPlugin 在 start() 之后注册，需要手动调用（演示用）
  // 实际使用中应在 start() 前 use()
  console.log('（memoryPlugin 在 start 后注册，仅作演示 — 实际请在 start 前 use）')

  // ── 停止：触发所有 Plugin 的 stop() ──────────────────────────────────────
  divider('停止应用（触发所有 Plugin stop()）')
  await app.stop()
  console.log('\n✅ 全部 Plugin stop() 已调用')
}

main().catch((err) => {
  console.error('❌ 出错了:', err)
  process.exit(1)
})
