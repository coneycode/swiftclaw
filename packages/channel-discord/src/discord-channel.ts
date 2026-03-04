import { Client, GatewayIntentBits, Events, type Message as DiscordMessage } from 'discord.js'
import type { Plugin, AppContext } from 'swiftclaw'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiscordChannelOptions {
  /** Discord Bot Token (from Discord Developer Portal) */
  token: string
  /**
   * 处理消息的回调函数。
   * 当收到用户 @机器人 或私信时被调用，返回 Bot 的回复内容。
   *
   * @param threadId 会话唯一标识（格式: 'discord:{channelId}' 或 'discord:dm:{userId}'）
   * @param userId   发送者的 Discord user ID
   * @param text     清洗后的消息文本（已去掉 @机器人 前缀）
   * @returns        Bot 的回复文本
   */
  handleMessage: (threadId: string, userId: string, text: string) => Promise<string>
  /**
   * 触发模式:
   * - 'mention' (默认) — 仅当 @机器人 时触发
   * - 'all' — 所有消息都触发（适合私聊频道）
   */
  triggerMode?: 'mention' | 'all'
}

// ─── DiscordChannel ───────────────────────────────────────────────────────────

/**
 * DiscordChannel — Discord 渠道 Plugin
 *
 * 功能:
 * - 监听 Discord 消息（@机器人 或全部消息）
 * - 提取消息文本，通过 AppContext EventBus 发布 'message.received' 事件
 * - 监听 'message.reply' 事件，通过 Discord API 回复消息
 * - 优雅处理重连和错误
 *
 * 使用方法:
 * ```typescript
 * const app = new SwiftClaw()
 * const agent = app.createAgent({ id: 'discord-agent', model: 'anthropic/claude-sonnet-4-5' })
 *
 * app.use(new DiscordChannel({
 *   token: process.env.DISCORD_BOT_TOKEN!,
 *   handleMessage: (threadId, userId, text) => agent.run(threadId, text),
 * }))
 *
 * await app.start()
 * ```
 */
export class DiscordChannel implements Plugin {
  readonly name = 'discord'

  private readonly options: DiscordChannelOptions
  private client: Client | null = null
  private ctx: AppContext | null = null
  /** threadId → discord Message (for replying) */
  private pendingReplies = new Map<string, DiscordMessage>()

  constructor(options: DiscordChannelOptions) {
    this.options = options
  }

  // ─── Plugin lifecycle ─────────────────────────────────────────────────────

  async register(ctx: AppContext): Promise<void> {
    this.ctx = ctx

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    })

    // Handle incoming messages
    this.client.on(Events.MessageCreate, (message) => {
      void this._handleMessage(message)
    })

    // Handle errors
    this.client.on(Events.Error, (err) => {
      ctx.logger.error({ err }, 'Discord client error')
    })

    // Listen for reply events from EventBus → send via Discord API
    ctx.on('message.reply', (msg) => {
      if (msg.channel === 'discord') {
        void this._sendReply(msg.threadId, msg.text)
      }
    })

    // Login to Discord
    await this.client.login(this.options.token)
    ctx.logger.info({ channel: 'discord' }, 'Discord channel started')
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.destroy()
      this.client = null
    }
    this.ctx?.logger.info({ channel: 'discord' }, 'Discord channel stopped')
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async _handleMessage(message: DiscordMessage): Promise<void> {
    if (!this.ctx || !this.client) return

    // Ignore messages from bots (including self)
    if (message.author.bot) return

    const botUser = this.client.user
    const triggerMode = this.options.triggerMode ?? 'mention'

    // Check trigger conditions
    const isMentioned = botUser ? message.mentions.has(botUser) : false
    const isDM = message.channel.isDMBased()

    if (triggerMode === 'mention' && !isMentioned && !isDM) return

    // Extract text, remove @bot mention
    let text = message.content
    if (botUser) {
      text = text.replace(new RegExp(`<@!?${botUser.id}>`, 'g'), '').trim()
    }
    if (!text) return

    const threadId = isDM
      ? `discord:dm:${message.author.id}`
      : `discord:${message.channelId}`

    const userId = message.author.id

    // Store message for replying
    this.pendingReplies.set(threadId, message)

    // Publish message.received event
    this.ctx.emit('message.received', {
      channel: 'discord',
      threadId,
      userId,
      text,
      raw: message,
    })

    // Invoke the message handler
    try {
      const reply = await this.options.handleMessage(threadId, userId, text)
      this.ctx.emit('message.reply', {
        channel: 'discord',
        threadId,
        text: reply,
      })
    } catch (err) {
      this.ctx.logger.error({ err, threadId }, 'Error handling Discord message')
    }
  }

  private async _sendReply(threadId: string, text: string): Promise<void> {
    if (!this.ctx) return

    const originalMessage = this.pendingReplies.get(threadId)
    if (!originalMessage) return

    try {
      // Split long messages (Discord limit: 2000 chars)
      const chunks = splitMessage(text, 2000)
      for (const chunk of chunks) {
        await originalMessage.reply(chunk)
      }
    } catch (err) {
      this.ctx.logger.error({ err, threadId }, 'Failed to send Discord reply')
    } finally {
      this.pendingReplies.delete(threadId)
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLength))
    remaining = remaining.slice(maxLength)
  }
  return chunks
}
