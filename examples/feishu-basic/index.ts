/**
 * 06-feishu — 飞书机器人完整示例
 *
 * 覆盖功能:
 *   ✅ FeishuChannel Plugin 注册
 *   ✅ WebSocket 模式接收事件（无需公网 IP）
 *   ✅ 收到消息 → Agent 处理 → 回复到飞书
 *   ✅ 多轮对话（同一 chat 的 threadId 保持一致）
 *   ✅ 流式感知（agent.run 返回后一次性发送）
 *   ✅ 优雅关闭（SIGINT/SIGTERM）
 *
 * 飞书后台配置步骤:
 *   1. 访问 https://open.feishu.cn/app
 *   2. 创建企业自建应用
 *   3. 开启「机器人」能力
 *   4. 事件订阅 → 使用「长连接」模式（无需公网 IP）
 *   5. 订阅事件：im.message.receive_v1
 *   6. 权限：im:message（发送消息）、im:message.group_at_msg（接收 @ 消息）
 *
 * 运行:
 *   FEISHU_APP_ID=cli_xxx \
 *   FEISHU_APP_SECRET=xxx \
 *   ANTHROPIC_API_KEY=sk-ant-xxx \
 *   tsx index.ts
 */

import { SwiftClaw } from 'swiftclaw'
import { createAnthropic } from '@ai-sdk/anthropic'
import { FeishuChannel } from '@swiftclaw/feishu'
import { createSearch, createDuckDuckGoSearch } from '@swiftclaw/tools'

// ─── 环境变量检查 ──────────────────────────────────────────────────────────────
function checkEnv() {
  const required = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'ANTHROPIC_API_KEY']
  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error('❌ 缺少环境变量:', missing.join(', '))
    console.error('')
    console.error('运行方式:')
    console.error('  FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx ANTHROPIC_API_KEY=sk-ant-xxx tsx index.ts')
    process.exit(1)
  }
}

// ─── 主函数 ────────────────────────────────────────────────────────────────────
async function main() {
  checkEnv()

  // 1. 创建应用（记忆存储在 ./feishu-memory）
  const app = new SwiftClaw({ memoryDir: './feishu-memory' })

  // 2. 注册 Anthropic Provider
  app.registerProvider('anthropic', createAnthropic({
    apiKey: process.env['ANTHROPIC_API_KEY']!,
  }))

  // 3. 创建 Agent（带搜索工具，可以查询最新信息）
  const agent = app.createAgent({
    id: 'feishu-bot',
    model: 'anthropic/claude-haiku-3-5',
    instructions: [
      '你是一个部署在飞书群的 AI 助手。',
      '用简洁、友好的中文回复，不使用 markdown 格式（飞书纯文本模式）。',
      '如果需要查询最新信息，使用 search 工具。',
      '每次回复不超过 200 字，除非用户明确要求详细解释。',
    ].join('\n'),
    tools: {
      search: createSearch(createDuckDuckGoSearch()),
    },
  })

  // 4. 监听事件（可选：记录日志）
  app.on('message.received', (msg) => {
    console.log(`[${new Date().toLocaleTimeString()}] 收到消息 | thread=${msg.threadId} | user=${msg.userId}`)
    console.log(`  内容: ${msg.text.slice(0, 80)}${msg.text.length > 80 ? '...' : ''}`)
  })

  app.on('message.reply', (msg) => {
    if (msg.channel === 'feishu') {
      console.log(`[${new Date().toLocaleTimeString()}] 发送回复 | thread=${msg.threadId}`)
      console.log(`  内容: ${msg.text.slice(0, 80)}${msg.text.length > 80 ? '...' : ''}`)
    }
  })

  // 5. 注册飞书渠道 Plugin
  app.use(new FeishuChannel({
    appId: process.env['FEISHU_APP_ID']!,
    appSecret: process.env['FEISHU_APP_SECRET']!,
    // 可选：飞书控制台的 Verification Token（增加安全性）
    // verificationToken: process.env['FEISHU_VERIFICATION_TOKEN'],
    handleMessage: async (threadId, _userId, text) => {
      // threadId 格式: 'feishu:{chat_id}'，同一个群的消息 threadId 相同
      // 因此同一群的对话自动共享历史记忆
      const reply = await agent.run(threadId, text)
      return reply
    },
  }))

  // 6. 启动
  await app.start()
  console.log('')
  console.log('✅ 飞书机器人已启动（WebSocket 长连接模式）')
  console.log('   在飞书群里 @机器人 或发送消息即可测试')
  console.log('   按 Ctrl+C 退出')
  console.log('')

  // 7. 优雅关闭
  const shutdown = async () => {
    console.log('\n正在关闭...')
    await app.stop()
    process.exit(0)
  }
  process.on('SIGINT', () => { void shutdown() })
  process.on('SIGTERM', () => { void shutdown() })
}

void main()
