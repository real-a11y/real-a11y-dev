# Contributing to Real A11y

Thanks for your interest in contributing to Real A11y. This guide covers how to set up the project, make changes, and submit contributions.

## Getting started

### Prerequisites

- Node.js >= 20
- pnpm >= 9

### Setup

```bash
git clone https://github.com/real-a11y/real-a11y-dev.git
cd real-a11y
pnpm install
pnpm build
pnpm test
```

### Project structure

```
packages/
├── core/              # @real-a11y-dev/core — tree extraction, data model, interaction engine
├── ui/                # @real-a11y-dev/semantic-navigator-ui — Preact tree components
├── extension/         # Chrome extension (Side Panel + Content Script) — "Semantic Navigator"
├── inspector/         # @real-a11y-dev/inspector — framework-agnostic tree panel (Shadow DOM embed)
├── react/             # @real-a11y-dev/react — React wrapper + hooks
├── testing/           # @real-a11y-dev/testing — audit/interaction helpers (Vitest/Jest/Playwright)
└── storybook-addon/   # @real-a11y-dev/storybook-addon — per-story tree panel
```

Dependency graph:
- `extension → ui → core`
- `inspector → ui → core`
- `react → inspector → ui → core`
- `storybook-addon → ui → core` (+ `testing`)
- `testing → core` (headless — no `ui` dep)

## Development workflow

### Building

```bash
pnpm build              # Build all packages
pnpm --filter @real-a11y-dev/core build   # Build a specific package
```

### Testing

```bash
pnpm test               # Run all tests
pnpm --filter @real-a11y-dev/core test    # Test a specific package
pnpm --filter @real-a11y-dev/core test:watch  # Watch mode
```

### Testing the Chrome extension

1. Run `pnpm build`
2. Open `chrome://extensions`
3. Enable Developer mode
4. Click "Load unpacked" and select `packages/extension/dist`
5. Navigate to any page and click the extension icon

## Making changes

### Branch naming

- `feat/description` — New features
- `fix/description` — Bug fixes
- `docs/description` — Documentation changes
- `refactor/description` — Code refactoring

### Code style

- TypeScript strict mode is enforced
- Use meaningful variable and function names
- Keep functions focused and small
- Add JSDoc comments only where the intent isn't obvious from the code

### Testing expectations

- New features in `packages/core` should include unit tests
- Role mapping changes should be tested against the WAI-ARIA specification
- UI component changes should be manually tested in both the extension and npm package contexts

### Accessibility

This is an accessibility tool — the tool itself must be fully accessible:

- Follow the [WAI-ARIA TreeView pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/) for tree components
- All interactive elements must be keyboard accessible
- Use proper ARIA roles, states, and properties
- Support both light and dark themes
- Test with a screen reader before submitting UI changes

## Submitting a pull request

1. Fork the repo and create your branch from `main`
2. Make your changes and ensure all tests pass (`pnpm test`)
3. Ensure the build succeeds (`pnpm build`)
4. Write a clear PR description explaining what changed and why
5. Link any related issues

## Reporting issues

When reporting a bug, please include:

- Browser and version
- Steps to reproduce
- Expected vs actual behavior
- The page URL (if the issue is specific to a page's DOM structure)

## Code of conduct

Be respectful, constructive, and inclusive. We're building tools to make the web more accessible — let's make our community accessible too.
