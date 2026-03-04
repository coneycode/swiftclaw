/**
 * 01-basic-agent — 基础 Agent 功能演示
 *
 * 覆盖功能:
 *   ✅ 创建 SwiftClaw 应用
 *   ✅ 注册 LLM Provider
 *   ✅ 单次问答 (agent.run)
 *   ✅ 流式输出 (agent.stream)
 *   ✅ 多轮对话（同一 threadId）
 *   ✅ System instructions
 *
 * 运行:
 *   ANTHROPIC_API_KEY=sk-ant-xxx tsx index.ts
 *
 * 也可以用 OpenAI:
 *   OPENAI_API_KEY=sk-xxx MODEL=openai/gpt-4o-mini tsx index.ts
 */

import { SwiftClaw } from 'swiftclaw'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function divider(title: string) {
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`  ${title}`)
  console.log('─'.repeat(50))
}

function checkEnv() {
  const hasAnthropic = !!process.env['ANTHROPIC_API_KEY']
  const hasOpenAI = !!process.env['OPENAI_API_KEY']
  if (!hasAnthropic && !hasOpenAI) {
    console.error('❌ 需要设置环境变量:')
    console.error('   ANTHROPIC_API_KEY=sk-ant-xxx  (推荐)')
    console.error('   或 OPENAI_API_KEY=sk-xxx')
    process.exit(1)
  }
  return hasAnthropic ? 'anthropic' : 'openai'
}

// ─── 主函数 ───────────────────────────────────────────────────────────────────

async function main() {
  const providerName = checkEnv()

  // ── 1. 创建应用 ────────────────────────────────────────────────────────────
  const app = new SwiftClaw({ memoryDir: './tmp/memory' })

  if (providerName === 'anthropic') {
    app.registerProvider('anthropic', createAnthropic({
      apiKey: process.env['ANTHROPIC_API_KEY']!,
      baseURL: 'https://api.minimaxi.com/anthropic/v1',
    }))
  } else {
    app.registerProvider('openai', createOpenAI({
      apiKey: process.env['OPENAI_API_KEY']!,
    }))
  }

  const MODEL = process.env['MODEL']
    ?? (providerName === 'anthropic' ? 'anthropic/claude-haiku-3-5' : 'openai/gpt-4o-mini')

  console.log(`\n🚀 SwiftClaw Basic Agent Demo`)
  console.log(`   Provider: ${providerName}`)
  console.log(`   Model:    ${MODEL}`)

  await app.start()

  // ── 2. 创建 Agent（带 system instructions）────────────────────────────────
  const agent = app.createAgent({
    id: 'demo-agent',
    model: MODEL,
    instructions: [
      '你是一个简洁、友好的中文助手。',
      '每次回答不超过 3 句话，除非用户要求详细解释。',
      '回答结尾加一个相关 emoji。',
    ].join('\n'),
  })

  // ── 3. 单次问答 ────────────────────────────────────────────────────────────
  divider('测试 1: 单次问答 (agent.run)')

  const reply1 = await agent.run('thread-demo-1', '用一句话解释什么是 TypeScript？')
  console.log(`用户: 用一句话解释什么是 TypeScript？`)
  console.log(`Agent: ${reply1}`)

  // ── 4. 流式输出 ────────────────────────────────────────────────────────────
  divider('测试 2: 流式输出 (agent.stream)')

  console.log('用户: 给我讲一个程序员的冷笑话')
  process.stdout.write('Agent: ')
  let streamedText = ''
  for await (const chunk of agent.stream('thread-demo-2', '给我讲一个程序员的冷笑话')) {
    process.stdout.write(chunk)
    streamedText += chunk
  }
  console.log(`\n\n[已接收 ${streamedText.length} 个字符，共 ${streamedText.split('\n').length} 行]`)

  // ── 5. 多轮对话（记忆） ────────────────────────────────────────────────────
  divider('测试 3: 多轮对话（同一 threadId = 共享记忆）')

  const threadId = 'thread-multi-turn'

  const turns = [
    '我叫小明，是一名前端工程师',
    '我最近在学习 Rust，你觉得难吗？',
    '你还记得我的名字和职业吗？',
  ]

  for (const userMsg of turns) {
    const reply = await agent.run(threadId, userMsg)
    console.log(`\n👤 用户: ${userMsg}`)
    console.log(`🤖 Agent: ${reply}`)
  }

  // ── 6. 不同 threadId = 独立会话 ───────────────────────────────────────────
  divider('测试 4: 不同 threadId = 独立会话（无共享记忆）')

  await agent.run('session-A', '我的名字叫 Alice')
  const replyB = await agent.run('session-B', '你知道我叫什么名字吗？')
  console.log(`session-A 告诉了 agent 名字叫 Alice`)
  console.log(`session-B 询问名字: ${replyB}`)
  console.log(`（正确结果：session-B 不知道 Alice，因为 threadId 不同）`)

  // ── 完成 ──────────────────────────────────────────────────────────────────
  divider('✅ 全部测试完成')
  console.log('记忆文件存储在: ./tmp/memory/')

  await app.stop()
}

main().catch((err) => {
  console.error('❌ 出错了:', err)
  process.exit(1)
})
