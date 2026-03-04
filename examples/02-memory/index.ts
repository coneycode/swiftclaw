/**
 * 02-memory — 记忆系统演示
 *
 * 覆盖功能:
 *   ✅ FileMemory 直接读写（不依赖 Agent）
 *   ✅ 对话历史持久化（重启后仍然存在）
 *   ✅ getHistory + limit（取最近 N 条）
 *   ✅ 工作记忆 (working memory) — 结构化持久信息
 *   ✅ 自定义 Memory 目录
 *   ✅ threadId 含特殊字符（冒号）的编码处理
 *   ✅ Agent 级别的记忆隔离
 *
 * 运行:
 *   ANTHROPIC_API_KEY=sk-ant-xxx tsx index.ts
 *
 * 注意: 第二次运行时可以看到记忆被持久化（历史条数会增加）
 */

import { SwiftClaw, FileMemory } from 'swiftclaw'
import { createAnthropic } from '@ai-sdk/anthropic'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const MEMORY_DIR = './tmp/memory-demo'

function divider(title: string) {
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`  ${title}`)
  console.log('─'.repeat(50))
}

async function main() {
  if (!process.env['ANTHROPIC_API_KEY']) {
    console.error('❌ 需要设置 ANTHROPIC_API_KEY')
    process.exit(1)
  }

  // ── 1. 直接使用 FileMemory（无需 Agent）───────────────────────────────────
  divider('测试 1: FileMemory 直接读写')

  const memory = new FileMemory(MEMORY_DIR)

  // 写入消息
  await memory.appendMessage('test-thread', { role: 'user', content: '你好', createdAt: Date.now() })
  await memory.appendMessage('test-thread', { role: 'assistant', content: '你好！有什么可以帮你的？', createdAt: Date.now() })
  await memory.appendMessage('test-thread', { role: 'user', content: '今天天气怎么样？', createdAt: Date.now() })

  const history = await memory.getHistory('test-thread')
  console.log(`✅ 写入 3 条消息，读出 ${history.length} 条`)
  history.forEach((msg, i) => {
    console.log(`  [${i + 1}] ${msg.role}: ${msg.content}`)
  })

  // ── 2. getHistory with limit ───────────────────────────────────────────────
  divider('测试 2: getHistory(limit) — 只取最近 N 条')

  // 写入更多消息
  for (let i = 4; i <= 8; i++) {
    await memory.appendMessage('test-thread', {
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `第 ${i} 条消息`,
      createdAt: Date.now(),
    })
  }

  const all = await memory.getHistory('test-thread')
  const last3 = await memory.getHistory('test-thread', 3)
  console.log(`总计 ${all.length} 条消息，取最后 3 条:`)
  last3.forEach(msg => console.log(`  ${msg.role}: ${msg.content}`))

  // ── 3. 工作记忆 (Working Memory) ──────────────────────────────────────────
  divider('测试 3: 工作记忆（结构化持久状态）')

  // 写入工作记忆
  await memory.setWorking('my-agent', {
    userName: '小明',
    preferences: { language: 'zh', verbosity: 'concise' },
    sessionCount: 1,
  })
  console.log('✅ 已写入工作记忆')

  // 读取工作记忆
  const working = await memory.getWorking('my-agent')
  console.log('读取工作记忆:', JSON.stringify(working, null, 2))

  // 更新（增加 sessionCount）
  const updated = { ...working, sessionCount: (working['sessionCount'] as number) + 1 }
  await memory.setWorking('my-agent', updated)
  const working2 = await memory.getWorking('my-agent')
  console.log(`✅ sessionCount 更新: ${working['sessionCount']} → ${working2['sessionCount']}`)

  // ── 4. threadId 含特殊字符 ─────────────────────────────────────────────────
  divider('测试 4: threadId 含冒号（自动 encodeURIComponent）')

  const specialThreadId = 'feishu:oc_abc123:sub-thread'
  await memory.appendMessage(specialThreadId, { role: 'user', content: '来自飞书的消息', createdAt: Date.now() })
  const msgs = await memory.getHistory(specialThreadId)
  console.log(`✅ threadId="${specialThreadId}"`)
  console.log(`   读出 ${msgs.length} 条消息: "${msgs[0]?.content}"`)

  // 查看实际文件名（应该是编码后的）
  const threadsDir = path.join(MEMORY_DIR, 'threads')
  const files = await fs.readdir(threadsDir)
  const encodedFile = files.find(f => f.includes('%3A'))
  console.log(`   实际文件名: ${encodedFile} (冒号被编码为 %3A)`)

  // ── 5. 持久化验证 ──────────────────────────────────────────────────────────
  divider('测试 5: 持久化验证（创建新 FileMemory 实例读取同一目录）')

  // 创建一个新的 FileMemory 实例指向同一目录
  const memory2 = new FileMemory(MEMORY_DIR)
  const persisted = await memory2.getHistory('test-thread')
  console.log(`✅ 新实例读取 'test-thread'，共 ${persisted.length} 条（应与上面一致）`)

  const persistedWorking = await memory2.getWorking('my-agent')
  console.log(`✅ 新实例读取工作记忆，sessionCount = ${persistedWorking['sessionCount']}`)

  // ── 6. Agent 使用 Memory ───────────────────────────────────────────────────
  divider('测试 6: Agent 与 Memory 集成')

  const app = new SwiftClaw({ memory })
  app.registerProvider('anthropic', createAnthropic({
    apiKey: process.env['ANTHROPIC_API_KEY']!,
    baseURL: 'https://api.minimaxi.com/anthropic/v1',
  }))

  const agent = app.createAgent({
    id: 'memory-demo-agent',
    model: process.env['MODEL'] ?? 'anthropic/MiniMax-M2.5',
    instructions: '你是一个友好的助手，用中文简短回复（不超过2句话）。',
  })

  await app.start()

  const agentThread = 'agent-memory-test'
  const r1 = await agent.run(agentThread, '我喜欢猫，我有一只叫做"球球"的橘猫。')
  console.log(`第1轮: ${r1}`)

  const r2 = await agent.run(agentThread, '我的猫叫什么名字？')
  console.log(`第2轮（记忆测试）: ${r2}`)
  console.log(`（正确答案应该包含"球球"）`)

  // 直接查看 Agent 写入的历史
  const agentHistory = await memory.getHistory(agentThread)
  console.log(`\n直接查看 memory，共 ${agentHistory.length} 条对话记录:`)
  agentHistory.forEach(m => console.log(`  [${m.role}] ${m.content.slice(0, 60)}...`))

  await app.stop()

  // ── 清理 ──────────────────────────────────────────────────────────────────
  divider('✅ 全部测试完成')
  console.log(`记忆文件存储在: ${MEMORY_DIR}`)
  console.log('再次运行此脚本，可以看到历史条数增加（验证持久化）')
}

main().catch((err) => {
  console.error('❌ 出错了:', err)
  process.exit(1)
})
