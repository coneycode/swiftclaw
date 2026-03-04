# Contributing to SwiftClaw

Thank you for your interest in contributing! This guide will help you get started.

---

## Development Setup

```bash
# 1. Fork and clone the repo
git clone https://github.com/your-username/swiftclaw.git
cd swiftclaw

# 2. Install dependencies (requires pnpm v9+)
pnpm install

# 3. Build all packages
pnpm build

# 4. Run tests to verify everything works
pnpm test
```

---

## Project Structure

```
swiftclaw/
├── packages/
│   ├── core/              ← swiftclaw (main package)
│   ├── channel-feishu/    ← @swiftclaw/feishu
│   ├── channel-discord/   ← @swiftclaw/discord
│   └── tools/             ← @swiftclaw/tools
├── examples/
│   ├── feishu-basic/
│   └── multi-agent/
└── .github/workflows/
```

---

## Development Workflow

```bash
# Run tests (watch mode)
pnpm dev

# Run tests once
pnpm test

# Type-check all packages
pnpm typecheck

# Build all packages
pnpm build

# Work on a specific package
pnpm --filter swiftclaw test
pnpm --filter @swiftclaw/tools typecheck
```

---

## Code Style

- **Language**: TypeScript 5 strict mode (`strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`)
- **Module system**: ESM with NodeNext resolution — use `.js` extensions in imports
- **Formatting**: No formatter enforced, but keep consistent with existing code
- **Comments**: Use Chinese for user-facing comments in core Chinese-focused docs; English in code logic

---

## Adding a New Channel

1. Create `packages/channel-{name}/` with the standard structure
2. Implement the `Plugin` interface from `swiftclaw`
3. Export a class like `XxxChannel` implementing:
   - `register(ctx: AppContext)` — start listening and set up event handlers
   - `stop()` — clean up connections
4. Listen for `message.received` → call `handleMessage` → emit `message.reply`
5. Add tests in `src/__tests__/`
6. Add to `examples/` if appropriate
7. Document in README.md

---

## Adding a New Tool

1. Add to `packages/tools/src/`
2. Use `defineTool()` from `swiftclaw`
3. Export a factory function (e.g., `createXxxTool()`)
4. Write tests that mock fetch
5. Export from `packages/tools/src/index.ts`

---

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Run `pnpm test && pnpm typecheck` before submitting
- Add tests for new functionality
- Update README.md if adding user-facing features

---

## Releasing

Releases are triggered by pushing a git tag:

```bash
# Update version in packages
pnpm --filter swiftclaw version patch
# Repeat for other packages as needed

# Commit and tag
git add .
git commit -m "chore: release v0.1.1"
git tag v0.1.1

# Push (triggers publish CI)
git push && git push --tags
```

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
