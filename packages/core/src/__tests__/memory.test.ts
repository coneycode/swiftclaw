import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { FileMemory } from '../memory.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'swiftclaw-memory-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('FileMemory.getHistory', () => {
  it('returns [] when file does not exist', async () => {
    const mem = new FileMemory(tmpDir)
    const msgs = await mem.getHistory('thread-1')
    expect(msgs).toEqual([])
  })

  it('returns messages after appendMessage', async () => {
    const mem = new FileMemory(tmpDir)
    await mem.appendMessage('t1', { role: 'user', content: 'hello' })
    await mem.appendMessage('t1', { role: 'assistant', content: 'hi there' })
    const msgs = await mem.getHistory('t1')
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'hello' })
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: 'hi there' })
  })

  it('respects limit — returns last N messages', async () => {
    const mem = new FileMemory(tmpDir)
    for (let i = 0; i < 5; i++) {
      await mem.appendMessage('t2', { role: 'user', content: `msg ${i}` })
    }
    const msgs = await mem.getHistory('t2', 3)
    expect(msgs).toHaveLength(3)
    expect(msgs[0]!.content).toBe('msg 2')
    expect(msgs[2]!.content).toBe('msg 4')
  })

  it('returns all messages when limit >= length', async () => {
    const mem = new FileMemory(tmpDir)
    await mem.appendMessage('t3', { role: 'user', content: 'only one' })
    const msgs = await mem.getHistory('t3', 10)
    expect(msgs).toHaveLength(1)
  })
})

describe('FileMemory.appendMessage', () => {
  it('accumulates messages across multiple appends', async () => {
    const mem = new FileMemory(tmpDir)
    await mem.appendMessage('thread-acc', { role: 'user', content: 'a' })
    await mem.appendMessage('thread-acc', { role: 'assistant', content: 'b' })
    await mem.appendMessage('thread-acc', { role: 'user', content: 'c' })
    const msgs = await mem.getHistory('thread-acc')
    expect(msgs).toHaveLength(3)
    expect(msgs.map(m => m.content)).toEqual(['a', 'b', 'c'])
  })

  it('handles threadId with colon (encodeURIComponent)', async () => {
    const mem = new FileMemory(tmpDir)
    const threadId = 'feishu:oc_abc123:sub'
    await mem.appendMessage(threadId, { role: 'user', content: 'encoded test' })
    const msgs = await mem.getHistory(threadId)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.content).toBe('encoded test')
    // Verify the file is NOT named with raw colons
    const files = await fs.readdir(path.join(tmpDir, 'threads'))
    expect(files[0]!).not.toContain(':')
    expect(files[0]!).toContain('%3A')
  })

  it('preserves all Message fields (id, createdAt)', async () => {
    const mem = new FileMemory(tmpDir)
    const msg = { role: 'user' as const, content: 'test', id: 'msg-1', createdAt: 1234567890 }
    await mem.appendMessage('t-full', msg)
    const msgs = await mem.getHistory('t-full')
    expect(msgs[0]).toEqual(msg)
  })
})

describe('FileMemory.getWorking', () => {
  it('returns {} when file does not exist', async () => {
    const mem = new FileMemory(tmpDir)
    const data = await mem.getWorking('agent-new')
    expect(data).toEqual({})
  })

  it('round-trips data with setWorking + getWorking', async () => {
    const mem = new FileMemory(tmpDir)
    const data = { name: 'Alice', count: 42, nested: { x: true } }
    await mem.setWorking('agent-1', data)
    const result = await mem.getWorking('agent-1')
    expect(result).toEqual(data)
  })

  it('overwrites previous working data', async () => {
    const mem = new FileMemory(tmpDir)
    await mem.setWorking('agent-2', { foo: 'bar' })
    await mem.setWorking('agent-2', { baz: 'qux' })
    const result = await mem.getWorking('agent-2')
    expect(result).toEqual({ baz: 'qux' })
    expect(result).not.toHaveProperty('foo')
  })
})

describe('FileMemory.setWorking — atomic write', () => {
  it('does not leave .tmp file after successful write', async () => {
    const mem = new FileMemory(tmpDir)
    await mem.setWorking('agent-atomic', { key: 'value' })
    const agentDir = path.join(tmpDir, 'agent-atomic')
    const files = await fs.readdir(agentDir)
    expect(files).toContain('working.json')
    expect(files).not.toContain('working.json.tmp')
  })
})

describe('FileMemory isolation', () => {
  it('different threadIds do not share history', async () => {
    const mem = new FileMemory(tmpDir)
    await mem.appendMessage('thread-A', { role: 'user', content: 'in A' })
    await mem.appendMessage('thread-B', { role: 'user', content: 'in B' })
    const a = await mem.getHistory('thread-A')
    const b = await mem.getHistory('thread-B')
    expect(a).toHaveLength(1)
    expect(a[0]!.content).toBe('in A')
    expect(b).toHaveLength(1)
    expect(b[0]!.content).toBe('in B')
  })

  it('different agentIds do not share working memory', async () => {
    const mem = new FileMemory(tmpDir)
    await mem.setWorking('agent-X', { x: 1 })
    await mem.setWorking('agent-Y', { y: 2 })
    const x = await mem.getWorking('agent-X')
    const y = await mem.getWorking('agent-Y')
    expect(x).toEqual({ x: 1 })
    expect(y).toEqual({ y: 2 })
  })
})
