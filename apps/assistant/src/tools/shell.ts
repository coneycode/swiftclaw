import { execSync } from 'node:child_process'
import { z } from 'zod'
import type { SwiftClawTool } from 'swiftclaw'

// ─── shell_run ────────────────────────────────────────────────────────────────

export const shellRun: SwiftClawTool<
  { command: string; cwd?: string; timeout_ms?: number },
  { stdout: string; stderr: string; exitCode: number }
> = {
  description:
    'Execute a shell command and return stdout/stderr/exitCode. ' +
    'Use for git commands, package managers, running scripts, checking system info, etc. ' +
    'Avoid interactive commands that require user input.',

  parameters: z.object({
    command: z.string().describe('Shell command to execute'),
    cwd: z.string().optional().describe('Working directory (default: current directory)'),
    timeout_ms: z.number().optional().describe('Timeout in milliseconds (default 30000)'),
  }),

  execute: async ({ command, cwd, timeout_ms = 30_000 }) => {
    try {
      const stdout = execSync(command, {
        cwd: cwd ?? process.cwd(),
        timeout: timeout_ms,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      })

      return {
        stdout: stdout.toString(),
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
    }
  },
}
