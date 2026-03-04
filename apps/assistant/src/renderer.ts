// ─── Terminal Renderer ────────────────────────────────────────────────────────
// Handles all styled terminal output for the assistant REPL

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const BLUE = '\x1b[34m'
const MAGENTA = '\x1b[35m'
const GRAY = '\x1b[90m'

export const renderer = {
  // ─── Startup banner ─────────────────────────────────────────────────────

  banner(model: string) {
    console.log()
    console.log(`${BOLD}${CYAN}╔═══════════════════════════════════════╗${RESET}`)
    console.log(`${BOLD}${CYAN}║   🦞  SwiftClaw Assistant             ║${RESET}`)
    console.log(`${BOLD}${CYAN}╚═══════════════════════════════════════╝${RESET}`)
    console.log(`${GRAY}   model : ${model}${RESET}`)
    console.log(`${GRAY}   type  : /help for commands${RESET}`)
    console.log()
  },

  // ─── Help text ───────────────────────────────────────────────────────────

  help() {
    console.log()
    console.log(`${BOLD}Commands:${RESET}`)
    console.log(`  ${CYAN}/help${RESET}        Show this help`)
    console.log(`  ${CYAN}/clear${RESET}       Clear screen`)
    console.log(`  ${CYAN}/history${RESET}     Show current session ID`)
    console.log(`  ${CYAN}/exit${RESET}        Exit the assistant`)
    console.log()
    console.log(`${BOLD}Tips:${RESET}`)
    console.log(`  • Ask me to write & run code — I'll execute it and show you the output`)
    console.log(`  • I can read/write files in your current directory`)
    console.log(`  • Run shell commands with full output`)
    console.log()
  },

  // ─── User prompt ─────────────────────────────────────────────────────────

  userPrompt(): string {
    return `${BOLD}${GREEN}You${RESET}${BOLD}: ${RESET}`
  },

  // ─── Assistant prefix ────────────────────────────────────────────────────

  assistantPrefix() {
    process.stdout.write(`\n${BOLD}${CYAN}Assistant${RESET}${BOLD}: ${RESET}`)
  },

  assistantEnd() {
    console.log()
    console.log()
  },

  // ─── Tool call display ───────────────────────────────────────────────────

  toolCall(toolName: string, args: unknown) {
    const argsStr = JSON.stringify(args, null, 2)
      .split('\n')
      .map((line, i) => i === 0 ? line : `         ${line}`)
      .join('\n')
    console.log(`\n${YELLOW}🔧 ${toolName}${RESET}${DIM}(${argsStr})${RESET}`)
  },

  toolResult(toolName: string, result: unknown) {
    const resultStr = typeof result === 'string'
      ? result
      : JSON.stringify(result, null, 2)

    // Truncate very long results
    const MAX = 800
    const display = resultStr.length > MAX
      ? resultStr.slice(0, MAX) + `\n${DIM}... (${resultStr.length - MAX} more chars)${RESET}`
      : resultStr

    const lines = display.split('\n')
    if (lines.length === 1) {
      console.log(`${GREEN}✅ ${RESET}${DIM}${display}${RESET}`)
    } else {
      console.log(`${GREEN}✅ ${toolName} result:${RESET}`)
      for (const line of lines) {
        console.log(`   ${GRAY}${line}${RESET}`)
      }
    }
  },

  toolError(toolName: string, error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.log(`${RED}❌ ${toolName} error: ${msg}${RESET}`)
  },

  // ─── Step separator ──────────────────────────────────────────────────────

  thinking() {
    process.stdout.write(`${DIM}${MAGENTA}⟳ thinking...${RESET}\r`)
  },

  clearThinking() {
    process.stdout.write('              \r') // overwrite the thinking line
  },

  // ─── Errors ──────────────────────────────────────────────────────────────

  error(msg: string) {
    console.error(`\n${RED}Error: ${msg}${RESET}\n`)
  },

  info(msg: string) {
    console.log(`${BLUE}ℹ ${msg}${RESET}`)
  },

  divider() {
    console.log(`${GRAY}${'─'.repeat(50)}${RESET}`)
  },

  // ─── Session info ─────────────────────────────────────────────────────────

  sessionInfo(threadId: string) {
    console.log()
    console.log(`${GRAY}Session: ${threadId}${RESET}`)
    console.log()
  },
}
