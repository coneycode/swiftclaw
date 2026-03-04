/**
 * 03-tools — 工具系统演示
 *
 * 覆盖功能:
 *   ✅ defineTool — 定义自定义工具
 *   ✅ Agent + 自定义工具（计算器、天气模拟）
 *   ✅ createSearch + createDuckDuckGoSearch（免费，无需 API Key）
 *   ✅ createSearch + createBraveSearch（需要 BRAVE_API_KEY）
 *   ✅ 工具调用链（Agent 自动决定何时调用工具）
 *   ✅ 工具执行错误处理
 *
 * 运行:
 *   ANTHROPIC_API_KEY=sk-ant-xxx tsx index.ts
 *
 * 可选（Brave Search 更精准）:
 *   ANTHROPIC_API_KEY=xxx BRAVE_API_KEY=xxx tsx index.ts
 */

import { SwiftClaw, defineTool, type SwiftClawTool } from 'swiftclaw'
import { createAnthropic } from '@ai-sdk/anthropic'
import {
  createSearch,
  createDuckDuckGoSearch,
  createBraveSearch,
} from '@swiftclaw/tools'
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

  const app = new SwiftClaw({ memoryDir: './tmp/memory-tools' })
  app.registerProvider('anthropic', createAnthropic({
    apiKey: process.env['ANTHROPIC_API_KEY']!,
    baseURL: 'https://api.minimaxi.com/anthropic/v1',
  }))
  await app.start()

  // ── 1. 自定义工具：计算器 ───────────────────────────────────────────────────
  divider('测试 1: 自定义工具（计算器）')

  const calculatorTool = defineTool({
    description: '执行数学计算。支持加减乘除和基本数学运算。返回计算结果。',
    parameters: z.object({
      expression: z.string().describe('要计算的数学表达式，例如 "2 + 3 * 4" 或 "Math.sqrt(16)"'),
    }),
    execute: async ({ expression }: { expression: string }) => {
      try {
        // 安全的数学计算（限制 eval 作用域）
        const result = Function(`"use strict"; return (${expression})`)() as number
        return { result, expression }
      } catch {
        return { error: `无法计算: ${expression}` }
      }
    },
  })

  const calcAgent = app.createAgent({
    id: 'calc-agent',
    model: process.env['MODEL'] ?? 'anthropic/MiniMax-M2.5',
    instructions: '你是一个数学助手。遇到计算题，必须使用 calculator 工具来计算，不要自己估算。用中文回答。',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: { calculator: calculatorTool } as Record<string, SwiftClawTool<any, any>>,
  })

  const mathQuestions = [
    '123 * 456 等于多少？',
    '16 的平方根是多少？',
  ]

  for (const q of mathQuestions) {
    const reply = await calcAgent.run(`calc-${Date.now()}`, q)
    console.log(`\n问: ${q}`)
    console.log(`答: ${reply}`)
  }

  // ── 2. 自定义工具：模拟天气查询 ────────────────────────────────────────────
  divider('测试 2: 自定义工具（模拟天气 API）')

  // 模拟天气数据
  const weatherDb: Record<string, { temp: number; desc: string; humidity: number }> = {
    '北京': { temp: 28, desc: '晴天', humidity: 40 },
    '上海': { temp: 32, desc: '多云', humidity: 75 },
    '广州': { temp: 35, desc: '阵雨', humidity: 90 },
    '成都': { temp: 26, desc: '阴天', humidity: 65 },
  }

  const weatherTool = defineTool({
    description: '查询指定城市的当前天气信息',
    parameters: z.object({
      city: z.string().describe('城市名称，例如"北京"、"上海"'),
    }),
    execute: async ({ city }: { city: string }) => {
      const weather = weatherDb[city]
      if (!weather) {
        return { error: `暂不支持查询 "${city}" 的天气` }
      }
      return {
        city,
        temperature: `${weather.temp}°C`,
        description: weather.desc,
        humidity: `${weather.humidity}%`,
        timestamp: new Date().toLocaleString('zh-CN'),
      }
    },
  })

  const weatherAgent = app.createAgent({
    id: 'weather-agent',
    model: process.env['MODEL'] ?? 'anthropic/MiniMax-M2.5',
    instructions: '你是一个天气助手。查询天气时必须调用 weather 工具，不要编造数据。用中文友好地回答。',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: { weather: weatherTool } as Record<string, SwiftClawTool<any, any>>,
  })

  const weatherQ = '帮我查一下北京和上海今天的天气，哪个城市更适合出行？'
  console.log(`\n问: ${weatherQ}`)
  const weatherReply = await weatherAgent.run('weather-thread', weatherQ)
  console.log(`答: ${weatherReply}`)

  // ── 3. 搜索工具：DuckDuckGo（免费，无需 API Key）────────────────────────────
  divider('测试 3: 搜索工具（DuckDuckGo，免费）')

  const ddgSearch = createSearch(createDuckDuckGoSearch())

  const searchAgent = app.createAgent({
    id: 'search-agent-ddg',
    model: process.env['MODEL'] ?? 'anthropic/MiniMax-M2.5',
    instructions: [
      '你是一个信息检索助手。',
      '当用户询问事实或最新信息时，使用 search 工具搜索。',
      '基于搜索结果用中文总结回答，注明信息来源。',
    ].join('\n'),
    tools: { search: ddgSearch },
  })

  const searchQ = '什么是 Vercel AI SDK？它有哪些主要特性？'
  console.log(`\n问: ${searchQ}`)
  process.stdout.write('答: ')
  for await (const chunk of searchAgent.stream(`ddg-search-${Date.now()}`, searchQ)) {
    process.stdout.write(chunk)
  }
  console.log()

  // ── 4. 搜索工具：Brave Search（可选，需要 API Key）───────────────────────────
  if (process.env['BRAVE_API_KEY']) {
    divider('测试 4: Brave Search（API Key 模式）')

    const braveSearch = createSearch(createBraveSearch({
      apiKey: process.env['BRAVE_API_KEY']!,
    }))

    const braveAgent = app.createAgent({
      id: 'search-agent-brave',
      model: process.env['MODEL'] ?? 'anthropic/MiniMax-M2.5',
      instructions: '你是一个信息检索助手。用搜索工具查找信息，用中文简洁回答。',
      tools: { search: braveSearch },
    })

    const braveQ = 'TypeScript 5.8 有哪些新特性？'
    console.log(`\n问: ${braveQ}`)
    const braveReply = await braveAgent.run(`brave-${Date.now()}`, braveQ)
    console.log(`答: ${braveReply}`)
  } else {
    divider('测试 4: Brave Search（跳过 — 未设置 BRAVE_API_KEY）')
    console.log('提示: 设置 BRAVE_API_KEY 可以测试 Brave Search')
  }

  // ── 5. 工具组合（一个 Agent 多个工具）────────────────────────────────────────
  divider('测试 5: 多工具组合（计算器 + 天气）')

  const comboAgent = app.createAgent({
    id: 'combo-agent',
    model: process.env['MODEL'] ?? 'anthropic/MiniMax-M2.5',
    instructions: '你是一个万能助手，有计算器和天气查询工具。需要时调用合适的工具，用中文回答。',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: {
      calculator: calculatorTool,
      weather: weatherTool,
    } as Record<string, SwiftClawTool<any, any>>,
  })

  const comboQ = '北京今天多少度？如果明天升温 15%，会是多少度？'
  console.log(`\n问: ${comboQ}`)
  const comboReply = await comboAgent.run(`combo-${Date.now()}`, comboQ)
  console.log(`答: ${comboReply}`)

  // ── 完成 ──────────────────────────────────────────────────────────────────
  divider('✅ 全部测试完成')
  await app.stop()
}

main().catch((err) => {
  console.error('❌ 出错了:', err)
  process.exit(1)
})
