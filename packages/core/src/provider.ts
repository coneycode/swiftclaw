import type { LanguageModel } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * Vercel AI SDK Provider 接口
 * 任何实现了 languageModel(id) 方法的对象都可以作为 Provider
 */
export interface Provider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  languageModel(modelId: string): any
}

// ─── ProviderRegistry ─────────────────────────────────────────────────────────

/**
 * ProviderRegistry — Provider 注册表
 *
 * 支持 'provider/model' 统一寻址格式。
 * 内置 anthropic 和 openai（从环境变量自动初始化）。
 * 支持注册自定义 Provider（OpenAI 兼容端点或完整 LanguageModelV1 实现）。
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>()

  /**
   * 注册一个 Provider
   * @param name Provider 名称，对应 'provider/model' 中的 provider 部分
   * @param provider 实现了 languageModel(id) 的对象
   */
  registerProvider(name: string, provider: Provider): void {
    this.providers.set(name, provider)
  }

  /**
   * 解析 'provider/model' 格式的 model 引用，返回 LanguageModel 对象
   * @param modelRef 如 'anthropic/claude-sonnet-4-5' 或 'openai/gpt-4o'
   */
  getModel(modelRef: string): LanguageModel {
    const slashIndex = modelRef.indexOf('/')
    if (slashIndex === -1) {
      throw new Error(
        `Invalid model ref: "${modelRef}". Expected format: "provider/model" (e.g. "anthropic/claude-sonnet-4-5")`,
      )
    }

    const providerName = modelRef.slice(0, slashIndex)
    const modelId = modelRef.slice(slashIndex + 1)

    const provider = this.providers.get(providerName)
    if (!provider) {
      throw new Error(
        `Provider "${providerName}" is not registered. ` +
        `Available providers: ${[...this.providers.keys()].join(', ') || '(none)'}. ` +
        `Register with app.registerProvider() or set the corresponding env var.`,
      )
    }

    return provider.languageModel(modelId)
  }

  /**
   * 从环境变量自动初始化内置 Provider
   * - ANTHROPIC_API_KEY → 注册 'anthropic'
   * - OPENAI_API_KEY    → 注册 'openai'
   */
  initFromEnv(): void {
    const anthropicKey = process.env['ANTHROPIC_API_KEY']
    if (anthropicKey && !this.providers.has('anthropic')) {
      this.registerProvider('anthropic', createAnthropic({ apiKey: anthropicKey }))
    }

    const openaiKey = process.env['OPENAI_API_KEY']
    if (openaiKey && !this.providers.has('openai')) {
      this.registerProvider('openai', createOpenAI({ apiKey: openaiKey }))
    }
  }

  /**
   * 检查某个 Provider 是否已注册（测试用）
   */
  hasProvider(name: string): boolean {
    return this.providers.has(name)
  }

  /**
   * 返回所有已注册 Provider 名称（测试/调试用）
   */
  listProviders(): string[] {
    return [...this.providers.keys()]
  }
}
