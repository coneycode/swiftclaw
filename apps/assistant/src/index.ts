/**
 * SwiftClaw Assistant — Local CLI personal assistant
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-cp-xxx pnpm start
 *
 * Commands in REPL:
 *   /help      - show help
 *   /clear     - clear screen
 *   /new       - start a new session (new thread)
 *   /history   - show current session ID
 *   /remember  - store a key=value in long-term memory
 *   /memory    - show stored memory
 *   /exit      - quit
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import * as path from 'node:path'
import * as url from 'node:url'
import { AssistantAgent } from './assistant-agent.js'
import { Repl } from './repl.js'
import { renderer } from './renderer.js'

// ─── Config ───────────────────────────────────────────────────────────────────

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const MEMORY_DIR = path.resolve(__dirname, '../memory')
const MODEL = process.env['MODEL'] ?? 'anthropic/MiniMax-M2.5'

// ─── Validate env ────────────────────────────────────────────────────────────

if (!process.env['ANTHROPIC_API_KEY']) {
  console.error('\x1b[31mError: ANTHROPIC_API_KEY is not set.\x1b[0m')
  console.error('  Copy .env.example to .env and fill in your key.')
  console.error('  Or: ANTHROPIC_API_KEY=sk-cp-xxx pnpm start')
  process.exit(1)
}

// ─── Setup model ─────────────────────────────────────────────────────────────

const anthropic = createAnthropic({
  apiKey: process.env['ANTHROPIC_API_KEY'],
  baseURL: 'https://api.minimaxi.com/anthropic/v1',
})

// Extract provider/model — e.g. 'anthropic/MiniMax-M2.5' → 'MiniMax-M2.5'
const modelId = MODEL.includes('/') ? MODEL.split('/').slice(1).join('/') : MODEL
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const llmModel = (anthropic as any)(modelId)

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  try {
    const agent = new AssistantAgent(llmModel, MEMORY_DIR)
    const repl = new Repl(agent, MODEL)
    await repl.start()
  } catch (err) {
    renderer.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

main()
