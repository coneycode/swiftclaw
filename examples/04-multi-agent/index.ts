/**
 * 04-multi-agent — Supervisor Pattern 多 Agent 协作演示
 *
 * 覆盖功能:
 *   ✅ Supervisor Agent 自动委托给 Sub-Agent
 *   ✅ Sub-Agent 使用工具（搜索）
 *   ✅ 子线程隔离（parentThreadId:subAgentId）
 *   ✅ maxSteps 控制（防止无限委托循环）
 *   ✅ 三层嵌套：Supervisor → 两个专家 Sub-Agent
 *   ✅ Supervisor 直接回答（不委托）vs 委托的对比
 *
 * 运行:
 *   ANTHROPIC_API_KEY=sk-ant-xxx tsx index.ts
 *
 * 注意: 使用 claude-sonnet 作为 Supervisor（决策更准确），
 *       使用 claude-haiku 作为 Sub-Agent（更便宜）
 */

import { SwiftClaw, defineTool, type SwiftClawTool } from 'swiftclaw'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createSearch, createDuckDuckGoSearch } from '@swiftclaw/tools'
import { z } from 'zod'

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

  const app = new SwiftClaw({ memoryDir: './tmp/memory-multi' })
  app.registerProvider('anthropic', createAnthropic({
    apiKey: process.env['ANTHROPIC_API_KEY']!,
    baseURL: 'https://api.minimaxi.com/anthropic/v1',
  }))
  await app.start()

  // ── 定义 Sub-Agents ────────────────────────────────────────────────────────

  // 搜索专家
  const searchAgent = app.createAgent({
    id: 'search-specialist',
    model: process.env['MODEL'] ?? 'anthropic/MiniMax-M2.5',
    description: [
      '网络信息搜索专家。',
      '当需要查询最新事件、新闻、技术文档、产品信息等实时或可能变化的信息时，委托给此 Agent。',
    ].join(''),
    instructions: [
      '你是一个专业的信息检索助手。',
      '收到任务后，先用 search 工具搜索相关信息，',
      '然后整理成清晰的中文摘要返回，并注明主要信息来源的 URL。',
    ].join('\n'),
    tools: { search: createSearch(createDuckDuckGoSearch()) },
  })

  // 代码专家
  const codeAgent = app.createAgent({
    id: 'code-specialist',
    model: process.env['MODEL'] ?? 'anthropic/MiniMax-M2.5',
    description: [
      '编程和代码专家。',
      '当需要写代码、解释代码、调试、代码审查、技术实现方案时，委托给此 Agent。',
    ].join(''),
    instructions: [
      '你是一个资深程序员，精通多种编程语言。',
      '用简洁清晰的代码和注释来回答。',
      '代码示例用 markdown 代码块包裹。',
      '用中文解释。',
    ].join('\n'),
  })

  // 写作专家
  const writerAgent = app.createAgent({
    id: 'writer-specialist',
    model: process.env['MODEL'] ?? 'anthropic/MiniMax-M2.5',
    description: [
      '写作和文字处理专家。',
      '当需要翻译、总结、润色文章、写邮件、改写文本时，委托给此 Agent。',
    ].join(''),
    instructions: [
      '你是一个专业的写作助手，擅长中英文写作、翻译、总结。',
      '保持语言流畅自然，根据用户需求调整风格（正式/口语）。',
    ].join('\n'),
  })

  // 数学工具
  const mathTool = defineTool({
    description: '执行精确的数学计算',
    parameters: z.object({
      expression: z.string().describe('数学表达式，如 "2**10" 或 "Math.PI * 5 ** 2"'),
    }),
    execute: async ({ expression }: { expression: string }) => {
      try {
        const result = Function(`"use strict"; return (${expression})`)()
        return { result: Number(result).toFixed(4), expression }
      } catch {
        return { error: `计算失败: ${expression}` }
      }
    },
  })

  // 数学专家（带工具）
  const mathAgent = app.createAgent({
    id: 'math-specialist',
    model: process.env['MODEL'] ?? 'anthropic/MiniMax-M2.5',
    description: [
      '数学和计算专家。',
      '当需要精确数学计算、公式推导、统计分析时，委托给此 Agent。',
    ].join(''),
    instructions: '你是一个数学专家。用 math 工具进行精确计算，用中文解释计算过程和结果。',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: { math: mathTool } as Record<string, SwiftClawTool<any, any>>,
  })

  // ── Supervisor ─────────────────────────────────────────────────────────────
  const supervisor = app.createAgent({
    id: 'supervisor',
    model: process.env['MODEL'] ?? 'anthropic/MiniMax-M2.5',
    instructions: [
      '你是一个智能助手协调员，管理多个专家 Sub-Agent。',
      '重要规则：',
      '• 每次最多调用一个工具一次。绝对不重复调用。',
      '• 收到工具返回结果后，必须直接输出最终文本回答用户。不得再调用任何工具。',
      '',
      '委托规则:',
      '- 搜索最新信息 → searchAgent',
      '- 编程/代码问题 → codeAgent',
      '- 翻译/总结/写作 → writerAgent',
      '- 数学计算 → mathAgent',
      '- 简单问题/日常闲聊 → 直接回答，不委托',
    ].join('\n'),
    subAgents: {
      searchAgent,
      codeAgent,
      writerAgent,
      mathAgent,
    },
    maxSteps: 3,
  })

  // ── 测试用例 ───────────────────────────────────────────────────────────────
  const testCases = [
    {
      label: '直接回答（无需委托）',
      question: '你好！你是谁？有什么能力？',
    },
    {
      label: '委托给代码专家',
      question: '用 TypeScript 写一个防抖函数（debounce），要求支持泛型和取消功能',
    },
    {
      label: '委托给写作专家（翻译）',
      question: '把这段话翻译成地道的英文: "这个框架轻量可拓展，专注于开发者体验"',
    },
    {
      label: '委托给数学专家',
      question: '计算圆面积公式：半径为 7.5 的圆，面积是多少？精确到小数点后2位',
    },
  ]

  for (const tc of testCases) {
    divider(`测试: ${tc.label}`)
    console.log(`用户: ${tc.question}`)
    process.stdout.write('Supervisor: ')

    const threadId = `supervisor-${Date.now()}`
    for await (const chunk of supervisor.stream(threadId, tc.question)) {
      process.stdout.write(chunk)
    }
    console.log('\n')

    // 短暂等待，避免触发 API rate limit
    await new Promise(r => setTimeout(r, 1000))
  }

  // ── 完成 ──────────────────────────────────────────────────────────────────
  divider('✅ 全部测试完成')
  console.log('架构: Supervisor → [search, code, writer, math] 四个专家 Sub-Agent')
  await app.stop()
}

main().catch((err) => {
  console.error('❌ 出错了:', err)
  process.exit(1)
})
