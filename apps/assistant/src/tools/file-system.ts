import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import type { SwiftClawTool } from 'swiftclaw'

// ─── file_read ────────────────────────────────────────────────────────────────

export const fileRead: SwiftClawTool<
  { file_path: string; start_line?: number; end_line?: number },
  string
> = {
  description:
    'Read the contents of a file. Optionally specify line range (1-indexed). ' +
    'Returns file content as a string.',

  parameters: z.object({
    file_path: z.string().describe('Absolute or relative path to the file'),
    start_line: z.number().optional().describe('Start line (1-indexed, inclusive)'),
    end_line: z.number().optional().describe('End line (1-indexed, inclusive)'),
  }),

  execute: async ({ file_path, start_line, end_line }) => {
    const resolved = path.resolve(file_path)
    const content = await fs.readFile(resolved, 'utf8')

    if (start_line !== undefined || end_line !== undefined) {
      const lines = content.split('\n')
      const start = (start_line ?? 1) - 1
      const end = end_line ?? lines.length
      return lines.slice(start, end).join('\n')
    }

    return content
  },
}

// ─── file_write ───────────────────────────────────────────────────────────────

export const fileWrite: SwiftClawTool<
  { file_path: string; content: string },
  { success: boolean; path: string }
> = {
  description:
    'Write content to a file. Creates parent directories if they don\'t exist. ' +
    'Overwrites existing files.',

  parameters: z.object({
    file_path: z.string().describe('Absolute or relative path to the file'),
    content: z.string().describe('Content to write to the file'),
  }),

  execute: async ({ file_path, content }) => {
    const resolved = path.resolve(file_path)
    await fs.mkdir(path.dirname(resolved), { recursive: true })
    await fs.writeFile(resolved, content, 'utf8')
    return { success: true, path: resolved }
  },
}

// ─── list_dir ─────────────────────────────────────────────────────────────────

export const listDir: SwiftClawTool<
  { dir_path: string; recursive?: boolean },
  string[]
> = {
  description:
    'List files and directories in a path. ' +
    'Set recursive=true to list all files recursively (respects common ignore patterns).',

  parameters: z.object({
    dir_path: z.string().describe('Directory path to list'),
    recursive: z.boolean().optional().describe('List recursively (default false)'),
  }),

  execute: async ({ dir_path, recursive = false }) => {
    const resolved = path.resolve(dir_path)

    if (!recursive) {
      const entries = await fs.readdir(resolved, { withFileTypes: true })
      return entries.map(e => e.isDirectory() ? `${e.name}/` : e.name)
    }

    // Recursive listing, skip node_modules / .git / dist
    const IGNORE = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.DS_Store'])
    const results: string[] = []

    async function walk(dir: string, prefix = '') {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (IGNORE.has(entry.name)) continue
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          results.push(`${rel}/`)
          await walk(path.join(dir, entry.name), rel)
        } else {
          results.push(rel)
        }
      }
    }

    await walk(resolved)
    return results
  },
}
