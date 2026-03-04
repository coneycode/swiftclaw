import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineTool, toAiSdkTool, createToolMap } from '../tool.js'
import type { SwiftClawTool } from '../types.js'

describe('defineTool', () => {
  it('returns the same tool object with correct shape', () => {
    const myTool = defineTool({
      description: 'A test tool',
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => `result: ${query}`,
    })
    expect(myTool.description).toBe('A test tool')
    expect(typeof myTool.execute).toBe('function')
    expect(myTool.parameters).toBeDefined()
  })

  it('provides type inference — execute receives typed input', async () => {
    const addTool = defineTool({
      description: 'Add two numbers',
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => a + b,
    })
    const result = await addTool.execute({ a: 2, b: 3 })
    expect(result).toBe(5)
  })

  it('validates input via zod schema (parse check)', () => {
    const greetTool = defineTool({
      description: 'Greet user',
      parameters: z.object({ name: z.string().min(1) }),
      execute: async ({ name }) => `Hello, ${name}!`,
    })
    // Valid input parses successfully
    const parsed = greetTool.parameters.parse({ name: 'Alice' })
    expect(parsed).toEqual({ name: 'Alice' })
    // Invalid input throws
    expect(() => greetTool.parameters.parse({ name: '' })).toThrow()
  })
})

describe('toAiSdkTool', () => {
  it('returns an object with description, parameters, and execute', () => {
    const swiftTool = defineTool({
      description: 'Search the web',
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => `results for: ${query}`,
    })
    const aiTool = toAiSdkTool(swiftTool)
    expect(aiTool).toBeDefined()
    // AI SDK tool object has these properties
    expect(typeof aiTool).toBe('object')
    expect(aiTool).toHaveProperty('description', 'Search the web')
    expect(aiTool).toHaveProperty('parameters')
    expect(aiTool).toHaveProperty('execute')
  })

  it('execute function works correctly after conversion', async () => {
    const swiftTool = defineTool({
      description: 'Echo',
      parameters: z.object({ msg: z.string() }),
      execute: async ({ msg }) => `echo: ${msg}`,
    })
    const aiTool = toAiSdkTool(swiftTool)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (aiTool as any).execute({ msg: 'hello' }, { messages: [], toolCallId: 'test-id' })
    expect(result).toBe('echo: hello')
  })
})

describe('createToolMap', () => {
  it('converts a Record<string, SwiftClawTool> to AI SDK tool map', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, SwiftClawTool<any, any>> = {
      search: defineTool({
        description: 'Search',
        parameters: z.object({ q: z.string() }),
        execute: async ({ q }: { q: string }) => `search: ${q}`,
      }),
      calc: defineTool({
        description: 'Calculate',
        parameters: z.object({ expr: z.string() }),
        execute: async ({ expr }: { expr: string }) => `calc: ${expr}`,
      }),
    }
    const toolMap = createToolMap(tools)
    expect(Object.keys(toolMap)).toEqual(['search', 'calc'])
    expect(toolMap['search']).toHaveProperty('description', 'Search')
    expect(toolMap['calc']).toHaveProperty('description', 'Calculate')
  })

  it('handles empty tool map', () => {
    const toolMap = createToolMap({})
    expect(toolMap).toEqual({})
  })

  it('each tool in the map has execute function', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, SwiftClawTool<any, any>> = {
      ping: defineTool({
        description: 'Ping',
        parameters: z.object({ host: z.string() }),
        execute: async ({ host }: { host: string }) => `pong: ${host}`,
      }),
    }
    const toolMap = createToolMap(tools)
    expect(typeof toolMap['ping']?.execute).toBe('function')
  })
})
