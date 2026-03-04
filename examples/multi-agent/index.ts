/**
 * multi-agent — 多 Agent 协作示例（Supervisor Pattern）
 *
 * 示例场景：用户提问，Supervisor 自主决策将任务委托给最合适的 Sub-Agent
 *
 * Sub-Agents:
 * - 搜索专家 (search-agent): 负责搜索网络信息
 * - 写作专家 (writer-agent): 负责编写文案、总结、翻译
 *
 * 启动方式:
 *   ANTHROPIC_API_KEY=xxx tsx index.ts
 */
import { SwiftClaw } from 'swiftclaw'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createSearch, createDuckDuckGoSearch } from '@swiftclaw/tools'

async function main() {
  const app = new SwiftClaw()

  // Register Anthropic provider
  app.registerProvider('anthropic', createAnthropic({
    apiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
  }))

  // Search tool (using DuckDuckGo — no API key required)
  const searchTool = createSearch(createDuckDuckGoSearch())

  // Sub-Agent 1: Search specialist
  const searchAgent = app.createAgent({
    id: 'search-agent',
    model: 'anthropic/claude-haiku-3-5',
    description: 'Search the web for up-to-date information. Use this when the user asks about current events, news, or facts that may have changed recently.',
    instructions: 'You are a web search specialist. Search for the requested information and return a clear, concise summary of the findings.',
    tools: { search: searchTool },
  })

  // Sub-Agent 2: Writing specialist
  const writerAgent = app.createAgent({
    id: 'writer-agent',
    model: 'anthropic/claude-haiku-3-5',
    description: 'Write, summarize, translate, or edit text. Use this for any writing task: drafting emails, summarizing content, translating languages, proofreading.',
    instructions: 'You are a writing specialist. Help users write, summarize, translate, and edit text with clarity and precision.',
  })

  // Supervisor Agent: Orchestrates sub-agents
  const supervisor = app.createAgent({
    id: 'supervisor',
    model: 'anthropic/claude-sonnet-4-5',
    instructions: [
      'You are a helpful AI assistant with access to specialized sub-agents.',
      'When a user asks something, decide which sub-agent can best handle the request:',
      '- Use search-agent for current information, news, or facts',
      '- Use writer-agent for writing, editing, or translation tasks',
      'For general questions, answer directly without delegating.',
    ].join('\n'),
    subAgents: {
      searchAgent,
      writerAgent,
    },
    maxSteps: 5,
  })

  await app.start()

  console.log('SwiftClaw Multi-Agent Example')
  console.log('================================')
  console.log('The Supervisor will delegate to specialized sub-agents.')
  console.log('')

  // Interactive demo: run a few test queries
  const queries = [
    'What is TypeScript and what are its main benefits?',  // general — answer directly
    'Summarize this text in one sentence: "The quick brown fox jumps over the lazy dog."',  // writer-agent
  ]

  for (const query of queries) {
    console.log(`\nUser: ${query}`)
    const reply = await supervisor.run(`demo-thread-${Date.now()}`, query)
    console.log(`Supervisor: ${reply}`)
    console.log('---')
  }

  await app.stop()
}

void main()
