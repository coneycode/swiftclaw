import * as readline from 'node:readline'
import { randomUUID } from 'node:crypto'
import { renderer } from './renderer.js'
import type { AssistantAgent } from './assistant-agent.js'

// ─── REPL ─────────────────────────────────────────────────────────────────────

export class Repl {
  private readonly agent: AssistantAgent
  private readonly model: string
  private threadId: string
  private rl: readline.Interface

  constructor(agent: AssistantAgent, model: string) {
    this.agent = agent
    this.model = model
    this.threadId = this.newThreadId()
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    })
  }

  // ─── Start the REPL loop ────────────────────────────────────────────────

  async start(): Promise<void> {
    renderer.banner(this.model)
    this.prompt()
  }

  private prompt(): void {
    this.rl.question(renderer.userPrompt(), async (input) => {
      const trimmed = input.trim()

      if (!trimmed) {
        this.prompt()
        return
      }

      // Handle slash commands
      if (trimmed.startsWith('/')) {
        await this.handleCommand(trimmed)
        this.prompt()
        return
      }

      // Send to agent
      try {
        for await (const _ of this.agent.stream(this.threadId, trimmed)) {
          // streaming — output is handled inside AssistantAgent
        }
      } catch (err) {
        renderer.error(err instanceof Error ? err.message : String(err))
      }

      this.prompt()
    })

    // Handle Ctrl+C
    this.rl.on('SIGINT', () => {
      console.log('\n')
      renderer.info('Use /exit to quit')
      this.prompt()
    })
  }

  // ─── Slash commands ─────────────────────────────────────────────────────

  private async handleCommand(cmd: string): Promise<void> {
    const [command, ...args] = cmd.split(' ')

    switch (command) {
      case '/help':
        renderer.help()
        break

      case '/clear':
        console.clear()
        renderer.banner(this.model)
        break

      case '/new':
        this.threadId = this.newThreadId()
        renderer.info(`New session started: ${this.threadId}`)
        break

      case '/history':
        renderer.sessionInfo(this.threadId)
        break

      case '/remember': {
        // Usage: /remember key=value
        const joined = args.join(' ')
        const eqIdx = joined.indexOf('=')
        if (eqIdx === -1) {
          renderer.error('Usage: /remember key=value')
        } else {
          const key = joined.slice(0, eqIdx).trim()
          const value = joined.slice(eqIdx + 1).trim()
          await this.agent.remember(key, value)
          renderer.info(`Remembered: ${key} = ${value}`)
        }
        break
      }

      case '/memory': {
        const working = await this.agent.getWorking()
        if (Object.keys(working).length === 0) {
          renderer.info('No memory stored yet. Use /remember key=value to store something.')
        } else {
          console.log()
          console.log('\x1b[1mStored memory:\x1b[0m')
          for (const [k, v] of Object.entries(working)) {
            console.log(`  \x1b[36m${k}\x1b[0m = ${JSON.stringify(v)}`)
          }
          console.log()
        }
        break
      }

      case '/exit':
      case '/quit':
        console.log('\nGoodbye! 👋\n')
        this.rl.close()
        process.exit(0)
        break

      default:
        renderer.error(`Unknown command: ${command}. Type /help for available commands.`)
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private newThreadId(): string {
    const now = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    return `session-${now}-${randomUUID().slice(0, 8)}`
  }
}
