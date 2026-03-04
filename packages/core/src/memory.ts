import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Memory, Message } from './types.js'

// ─── FileMemory ────────────────────────────────────────────────────────────────

/**
 * FileMemory — 基于文件系统的默认 Memory 实现
 *
 * 目录布局:
 * ```
 * {baseDir}/
 *   threads/
 *     {encodedThreadId}.jsonl   ← 历史对话（append-only JSONL）
 *   {agentId}/
 *     working.json              ← 工作记忆（原子写入）
 * ```
 *
 * threadId 使用 encodeURIComponent() 编码后作为文件名，
 * 以兼容包含 ':' 的 threadId（如 'feishu:oc_xxx'）。
 */
export class FileMemory implements Memory {
  private readonly baseDir: string

  constructor(baseDir = './memory') {
    this.baseDir = baseDir
  }

  // ─── History ─────────────────────────────────────────────────────────────

  /**
   * 读取指定 thread 的历史消息
   * @param threadId 会话唯一标识
   * @param limit    返回最近 N 条消息（可选）
   */
  async getHistory(threadId: string, limit?: number): Promise<Message[]> {
    const filePath = this._threadPath(threadId)
    let content: string
    try {
      content = await fs.readFile(filePath, 'utf8')
    } catch (err: unknown) {
      if (isENOENT(err)) return []
      throw err
    }

    const messages: Message[] = []
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed) {
        try {
          messages.push(JSON.parse(trimmed) as Message)
        } catch {
          // 忽略损坏的行
        }
      }
    }

    if (limit !== undefined && messages.length > limit) {
      return messages.slice(messages.length - limit)
    }
    return messages
  }

  /**
   * 追加一条消息到 thread 历史（append-only）
   */
  async appendMessage(threadId: string, msg: Message): Promise<void> {
    const filePath = this._threadPath(threadId)
    await fs.mkdir(path.join(this.baseDir, 'threads'), { recursive: true })
    await fs.appendFile(filePath, JSON.stringify(msg) + '\n', 'utf8')
  }

  // ─── Working Memory ───────────────────────────────────────────────────────

  /**
   * 读取 agent 的工作记忆
   * @param agentId Agent 唯一标识
   */
  async getWorking(agentId: string): Promise<Record<string, unknown>> {
    const filePath = this._workingPath(agentId)
    let content: string
    try {
      content = await fs.readFile(filePath, 'utf8')
    } catch (err: unknown) {
      if (isENOENT(err)) return {}
      throw err
    }
    return JSON.parse(content) as Record<string, unknown>
  }

  /**
   * 原子写入 agent 工作记忆（写入 .tmp 后 rename，防止写入中途崩溃导致数据损坏）
   */
  async setWorking(agentId: string, data: Record<string, unknown>): Promise<void> {
    const dir = path.join(this.baseDir, agentId)
    await fs.mkdir(dir, { recursive: true })
    const filePath = this._workingPath(agentId)
    const tmpPath = filePath + '.tmp'
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8')
    await fs.rename(tmpPath, filePath)
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private _threadPath(threadId: string): string {
    return path.join(this.baseDir, 'threads', encodeURIComponent(threadId) + '.jsonl')
  }

  private _workingPath(agentId: string): string {
    return path.join(this.baseDir, agentId, 'working.json')
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isENOENT(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
}
