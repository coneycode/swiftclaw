import { execSync } from 'node:child_process'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { SwiftClawTool } from 'swiftclaw'

// ─── Types ────────────────────────────────────────────────────────────────────

const LANG_CONFIGS = {
  typescript: { ext: '.ts', runner: 'npx tsx' },
  javascript: { ext: '.js', runner: 'node' },
  python: { ext: '.py', runner: 'python3' },
  bash: { ext: '.sh', runner: 'bash' },
} as const

type Lang = keyof typeof LANG_CONFIGS

// ─── Tool ─────────────────────────────────────────────────────────────────────

export const codeExecute: SwiftClawTool<
  { lang: Lang; code: string; timeout_ms?: number },
  { stdout: string; stderr: string; exitCode: number }
> = {
  description:
    'Execute code and return the output. Supports TypeScript, JavaScript, Python, and Bash. ' +
    'Always write self-contained code with print/console.log statements to verify correctness. ' +
    'Include test assertions to validate the logic.',

  parameters: z.object({
    lang: z.enum(['typescript', 'javascript', 'python', 'bash']).describe(
      'Programming language to execute'
    ),
    code: z.string().describe('The code to execute'),
    timeout_ms: z.number().optional().describe('Execution timeout in milliseconds (default 30000)'),
  }),

  execute: async ({ lang, code, timeout_ms = 30_000 }) => {
    const config = LANG_CONFIGS[lang]
    const tmpFile = join(tmpdir(), `swiftclaw-exec-${Date.now()}${config.ext}`)

    try {
      writeFileSync(tmpFile, code, 'utf8')

      const result = execSync(`${config.runner} "${tmpFile}"`, {
        timeout: timeout_ms,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      })

      return {
        stdout: result.toString(),
        stderr: '',
        exitCode: 0,
      }
    } catch (err: unknown) {
      const execErr = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number; message?: string }
      return {
        stdout: execErr.stdout ? execErr.stdout.toString() : '',
        stderr: execErr.stderr ? execErr.stderr.toString() : (execErr.message ?? 'Unknown error'),
        exitCode: execErr.status ?? 1,
      }
    } finally {
      if (existsSync(tmpFile)) {
        try { unlinkSync(tmpFile) } catch { /* ignore */ }
      }
    }
  },
}
