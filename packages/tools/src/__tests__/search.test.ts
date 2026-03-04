import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createSearch,
  createBraveSearch,
  createDuckDuckGoSearch,
  createSearXNGSearch,
} from '../search.js'
import type { SearchProvider, SearchResult } from '../search.js'

// ─── Mock fetch globally ───────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── createSearch ─────────────────────────────────────────────────────────────

describe('createSearch', () => {
  it('wraps a provider into a SwiftClawTool with description and execute', async () => {
    const mockResults: SearchResult[] = [
      { title: 'Test', url: 'https://example.com', snippet: 'Test snippet' },
    ]
    const mockProvider: SearchProvider = {
      search: vi.fn().mockResolvedValue(mockResults),
    }

    const tool = createSearch(mockProvider)
    expect(tool.description).toContain('Search the web')
    expect(typeof tool.execute).toBe('function')

    const results = await tool.execute({ query: 'TypeScript' })
    expect(results).toEqual(mockResults)
    expect(mockProvider.search).toHaveBeenCalledWith('TypeScript', { count: 5 })
  })

  it('passes custom count to provider', async () => {
    const mockProvider: SearchProvider = {
      search: vi.fn().mockResolvedValue([]),
    }
    const tool = createSearch(mockProvider)
    await tool.execute({ query: 'test', count: 3 })
    expect(mockProvider.search).toHaveBeenCalledWith('test', { count: 3 })
  })

  it('validates parameters (zod schema enforces types)', () => {
    const mockProvider: SearchProvider = { search: vi.fn().mockResolvedValue([]) }
    const tool = createSearch(mockProvider)
    // Valid input
    expect(() => tool.parameters.parse({ query: 'hello' })).not.toThrow()
    // Invalid: missing query
    expect(() => tool.parameters.parse({})).toThrow()
    // Invalid: count out of range
    expect(() => tool.parameters.parse({ query: 'hi', count: 0 })).toThrow()
    expect(() => tool.parameters.parse({ query: 'hi', count: 11 })).toThrow()
  })
})

// ─── createBraveSearch ────────────────────────────────────────────────────────

describe('createBraveSearch', () => {
  it('sends correct request to Brave API', async () => {
    const mockResponse = {
      web: {
        results: [
          { title: 'Result 1', url: 'https://example.com/1', description: 'Snippet 1' },
          { title: 'Result 2', url: 'https://example.com/2', description: 'Snippet 2' },
        ],
      },
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    })

    const provider = createBraveSearch({ apiKey: 'test-key' })
    const results = await provider.search('TypeScript news', { count: 2 })

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('api.search.brave.com')
    expect(url).toContain('q=TypeScript+news')
    expect(url).toContain('count=2')
    expect((options.headers as Record<string, string>)['X-Subscription-Token']).toBe('test-key')

    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      title: 'Result 1',
      url: 'https://example.com/1',
      snippet: 'Snippet 1',
    })
  })

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' })
    const provider = createBraveSearch({ apiKey: 'test-key' })
    await expect(provider.search('test')).rejects.toThrow('429')
  })

  it('returns empty array when web.results is empty', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    })
    const provider = createBraveSearch({ apiKey: 'test-key' })
    const results = await provider.search('test')
    expect(results).toEqual([])
  })

  it('supports custom endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ web: { results: [] } }),
    })
    const provider = createBraveSearch({
      apiKey: 'key',
      endpoint: 'https://my-proxy.example.com/brave',
    })
    await provider.search('test')
    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toContain('my-proxy.example.com')
  })
})

// ─── createDuckDuckGoSearch ───────────────────────────────────────────────────

describe('createDuckDuckGoSearch', () => {
  it('fetches from DuckDuckGo API and returns results', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        Heading: 'TypeScript',
        AbstractText: 'TypeScript is a typed superset of JavaScript.',
        AbstractURL: 'https://www.typescriptlang.org/',
        RelatedTopics: [
          { FirstURL: 'https://example.com/1', Text: 'TypeScript - Getting Started' },
          { FirstURL: 'https://example.com/2', Text: 'TypeScript - Handbook' },
        ],
      }),
    })

    const provider = createDuckDuckGoSearch()
    const results = await provider.search('TypeScript')

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toContain('duckduckgo.com')

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.url).toBe('https://www.typescriptlang.org/')
  })

  it('handles empty DuckDuckGo response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    })
    const provider = createDuckDuckGoSearch()
    const results = await provider.search('obscure query')
    expect(results).toEqual([])
  })

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' })
    const provider = createDuckDuckGoSearch()
    await expect(provider.search('test')).rejects.toThrow('503')
  })
})

// ─── createSearXNGSearch ──────────────────────────────────────────────────────

describe('createSearXNGSearch', () => {
  it('fetches from SearXNG instance and maps results', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        results: [
          { title: 'SearX 1', url: 'https://example.com/1', content: 'Content 1' },
          { title: 'SearX 2', url: 'https://example.com/2', content: 'Content 2' },
        ],
      }),
    })

    const provider = createSearXNGSearch({ instanceUrl: 'https://searx.example.com' })
    const results = await provider.search('AI news', { count: 2 })

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toContain('searx.example.com')
    expect(url).toContain('/search')
    expect(url).toContain('q=AI+news')

    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      title: 'SearX 1',
      url: 'https://example.com/1',
      snippet: 'Content 1',
    })
  })

  it('respects count limit', async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      title: `Result ${i}`,
      url: `https://example.com/${i}`,
      content: `Content ${i}`,
    }))
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ results: manyResults }),
    })

    const provider = createSearXNGSearch({ instanceUrl: 'https://searx.example.com' })
    const results = await provider.search('test', { count: 3 })
    expect(results).toHaveLength(3)
  })

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 502, statusText: 'Bad Gateway' })
    const provider = createSearXNGSearch({ instanceUrl: 'https://searx.example.com' })
    await expect(provider.search('test')).rejects.toThrow('502')
  })
})
