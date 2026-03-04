import * as lark from '@larksuiteoapi/node-sdk'
import type { Plugin, AppContext } from 'swiftclaw'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FeishuChannelOptions {
  /** 飞书应用 App ID */
  appId: string
  /** 飞书应用 App Secret */
  appSecret: string
  /**
   * Webhook 验证 token（飞书控制台 > 事件订阅 > Verification Token）
   * 用于验证请求来源合法性
   */
  verificationToken?: string
  /**
   * HTTP 监听端口，默认 3000
   * 飞书事件推送会 POST 到此端口的 /webhook 路径
   */
  port?: number
  /**
   * 处理消息的 Agent 工厂函数。
   * 当收到用户消息时，此函数被调用，返回 Agent 的回复内容。
   *
   * @param threadId 会话唯一标识（格式: 'feishu:{chat_id}'）
   * @param userId   发送者的 open_id
   * @param text     清洗后的消息文本（已去掉 @机器人 等）
   * @returns        Agent 的回复文本
   */
  handleMessage: (threadId: string, userId: string, text: string) => Promise<string>
}

// ─── FeishuChannel ────────────────────────────────────────────────────────────

/**
 * FeishuChannel — 飞书/Lark 渠道 Plugin
 *
 * 功能:
 * - 监听飞书事件推送（im.message.receive_v1）
 * - 提取消息文本，通过 AppContext EventBus 发布 'message.received' 事件
 * - 监听 'message.reply' 事件，调用飞书 API 回复消息
 * - 启动 HTTP 服务接收 Webhook 事件
 *
 * 使用方法:
 * ```typescript
 * const app = new SwiftClaw()
 * const agent = app.createAgent({ id: 'feishu-agent', model: 'anthropic/claude-sonnet-4-5' })
 *
 * app.use(new FeishuChannel({
 *   appId: process.env.FEISHU_APP_ID!,
 *   appSecret: process.env.FEISHU_APP_SECRET!,
 *   handleMessage: (threadId, userId, text) => agent.run(threadId, text),
 * }))
 *
 * await app.start()
 * ```
 */
export class FeishuChannel implements Plugin {
  readonly name = 'feishu'

  private readonly options: FeishuChannelOptions
  private client: lark.Client | null = null
  private wsClient: lark.WSClient | null = null
  private ctx: AppContext | null = null

  constructor(options: FeishuChannelOptions) {
    this.options = options
  }

  // ─── Plugin lifecycle ─────────────────────────────────────────────────────

  async register(ctx: AppContext): Promise<void> {
    this.ctx = ctx

    // Create Feishu API client
    this.client = new lark.Client({
      appId: this.options.appId,
      appSecret: this.options.appSecret,
    })

    // Create WebSocket client for event subscription
    this.wsClient = new lark.WSClient({
      appId: this.options.appId,
      appSecret: this.options.appSecret,
    })

    // Register event handler for incoming messages
    const eventDispatcher = new lark.EventDispatcher({
      verificationToken: this.options.verificationToken ?? '',
    }).register({
      'im.message.receive_v1': async (data) => {
        await this._handleIncomingMessage(data)
      },
    })

    // Start WebSocket connection for real-time event delivery
    this.wsClient.start({ eventDispatcher })

    // Listen for reply events from EventBus → send via Feishu API
    ctx.on('message.reply', (msg) => {
      if (msg.channel === 'feishu') {
        void this._sendReply(msg.threadId, msg.text)
      }
    })

    ctx.logger.info({ channel: 'feishu' }, 'Feishu channel started (WebSocket mode)')
  }

  async stop(): Promise<void> {
    // WSClient doesn't have an explicit stop in all versions; no-op if not available
    this.ctx?.logger.info({ channel: 'feishu' }, 'Feishu channel stopped')
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async _handleIncomingMessage(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
  ): Promise<void> {
    if (!this.ctx) return

    const message = data?.message
    if (!message) return

    // Only handle text messages
    if (message.message_type !== 'text') return

    let text = ''
    try {
      const content = JSON.parse(message.content ?? '{}') as { text?: string }
      text = (content.text ?? '').trim()
    } catch {
      return
    }

    if (!text) return

    // Remove @bot mentions (format: @_user_{open_id} or @{name})
    text = text.replace(/@\S+/g, '').trim()
    if (!text) return

    const chatId = message.chat_id as string ?? ''
    const userId = data?.sender?.sender_id?.open_id as string ?? ''
    const threadId = `feishu:${chatId}`

    // Publish message.received event
    this.ctx.emit('message.received', {
      channel: 'feishu',
      threadId,
      userId,
      text,
      raw: data,
    })

    // Invoke the message handler (typically an Agent)
    try {
      const reply = await this.options.handleMessage(threadId, userId, text)
      // Publish reply event (will be picked up by our own listener)
      this.ctx.emit('message.reply', {
        channel: 'feishu',
        threadId,
        text: reply,
      })
    } catch (err) {
      this.ctx.logger.error({ err, threadId }, 'Error handling Feishu message')
    }
  }

  private async _sendReply(threadId: string, text: string): Promise<void> {
    if (!this.client || !this.ctx) return

    // Extract chat_id from threadId (format: 'feishu:{chat_id}')
    const chatId = threadId.replace(/^feishu:/, '')
    if (!chatId) return

    try {
      await this.client.im.message.create({
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
        params: {
          receive_id_type: 'chat_id',
        },
      })
    } catch (err) {
      this.ctx.logger.error({ err, threadId }, 'Failed to send Feishu reply')
    }
  }
}
