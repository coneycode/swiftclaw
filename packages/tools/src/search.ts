import { z } from 'zod'
import { defineTool } from 'swiftclaw'
import type { SwiftClawTool } from 'swiftclaw'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export interface SearchProvider {
  search(query: string, options?: { count?: number }): Promise<SearchResult[]>
}

// ─── createSearch ─────────────────────────────────────────────────────────────

/**
 * createSearch — 创建统一搜索工具
 *
 * 接受任意 SearchProvider（Brave、SearXNG、DuckDuckGo 等），
 * 返回一个 SwiftClawTool，可直接传给 Agent 的 tools 配置。
 *
 * ```typescript
 * const searchTool = createSearch(createBraveSearch({ apiKey: '...' }))
 * const agent = app.createAgent({
 *   id: 'search-agent',
 *   model: 'anthropic/claude-sonnet-4-5',
 *   tools: { search: searchTool },
 * })
 * ```
 */
export function createSearch(
  provider: SearchProvider,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): SwiftClawTool<any, SearchResult[]> {
  return defineTool({
    description:
      'Search the web for up-to-date information. ' +
      'Use this when you need current facts, news, or information not in your training data.',
    parameters: z.object({
      query: z.string().describe('The search query'),
      count: z.number().int().min(1).max(10).optional().describe('Number of results to return (1-10, default 5)'),
    }),
    execute: async ({ query, count = 5 }) => {
      return provider.search(query, { count })
    },
  })
}

// ─── Brave Search ─────────────────────────────────────────────────────────────

export interface BraveSearchOptions {
  apiKey: string
  /** Brave Web Search API endpoint, defaults to official endpoint */
  endpoint?: string
}

/**
 * createBraveSearch — 创建 Brave Search API provider
 *
 * 需要 Brave Search API Key（免费计划每月 2000 次）：
 * https://brave.com/search/api/
 */
export function createBraveSearch(options: BraveSearchOptions): SearchProvider {
  const endpoint = options.endpoint ?? 'https://api.search.brave.com/res/v1/web/search'

  return {
    async search(query, { count = 5 } = {}) {
      const url = new URL(endpoint)
      url.searchParams.set('q', query)
      url.searchParams.set('count', String(count))

      const resp = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': options.apiKey,
        },
      })

      if (!resp.ok) {
        throw new Error(`Brave Search API error: ${resp.status} ${resp.statusText}`)
      }

      const data = (await resp.json()) as BraveSearchResponse
      return (data.web?.results ?? []).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.description ?? '',
      }))
    },
  }
}

interface BraveSearchResponse {
  web?: {
    results: Array<{
      title: string
      url: string
      description?: string
    }>
  }
}

// ─── DuckDuckGo Search ────────────────────────────────────────────────────────

/**
 * createDuckDuckGoSearch — 创建 DuckDuckGo Instant Answer API provider
 *
 * 免费、无需 API Key，但结果质量和数量有限。
 * 适合开发/测试场景，或 Brave 额度用完时的 fallback。
 */
export function createDuckDuckGoSearch(): SearchProvider {
  return {
    async search(query, { count = 5 } = {}) {
      const url = new URL('https://api.duckduckgo.com/')
      url.searchParams.set('q', query)
      url.searchParams.set('format', 'json')
      url.searchParams.set('no_html', '1')
      url.searchParams.set('skip_disambig', '1')

      const resp = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      })

      if (!resp.ok) {
        throw new Error(`DuckDuckGo API error: ${resp.status} ${resp.statusText}`)
      }

      const data = (await resp.json()) as DuckDuckGoResponse
      const results: SearchResult[] = []

      // Abstract (top result)
      if (data.AbstractText && data.AbstractURL) {
        results.push({
          title: data.Heading ?? query,
          url: data.AbstractURL,
          snippet: data.AbstractText,
        })
      }

      // Related topics
      for (const topic of data.RelatedTopics ?? []) {
        if (results.length >= count) break
        if (topic.FirstURL && topic.Text) {
          results.push({
            title: topic.Text.split(' - ')[0] ?? topic.Text,
            url: topic.FirstURL,
            snippet: topic.Text,
          })
        }
      }

      return results.slice(0, count)
    },
  }
}

interface DuckDuckGoResponse {
  Heading?: string
  AbstractText?: string
  AbstractURL?: string
  RelatedTopics?: Array<{
    FirstURL?: string
    Text?: string
  }>
}

// ─── SearXNG Search ───────────────────────────────────────────────────────────

export interface SearXNGOptions {
  /** SearXNG 实例 URL，如 'https://searx.example.com' */
  instanceUrl: string
  /** 搜索语言，默认 'en' */
  language?: string
}

/**
 * createSearXNGSearch — 创建 SearXNG provider
 *
 * SearXNG 是开源的元搜索引擎，可自托管。
 * 支持聚合多个搜索引擎结果，无速率限制（取决于实例配置）。
 */
export function createSearXNGSearch(options: SearXNGOptions): SearchProvider {
  return {
    async search(query, { count = 5 } = {}) {
      const url = new URL('/search', options.instanceUrl)
      url.searchParams.set('q', query)
      url.searchParams.set('format', 'json')
      url.searchParams.set('language', options.language ?? 'en')
      url.searchParams.set('pageno', '1')

      const resp = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      })

      if (!resp.ok) {
        throw new Error(`SearXNG error: ${resp.status} ${resp.statusText}`)
      }

      const data = (await resp.json()) as SearXNGResponse
      return (data.results ?? []).slice(0, count).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.content ?? '',
      }))
    },
  }
}

interface SearXNGResponse {
  results?: Array<{
    title: string
    url: string
    content?: string
  }>
}
