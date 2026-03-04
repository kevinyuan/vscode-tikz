# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

VS Code extension ("TikZ in Markdown") that renders TikZ/LaTeX diagrams inside VS Code's built-in Markdown preview. Users write fenced `tikz` code blocks in Markdown; the extension renders them to SVG via `node-tikzjax` (WASM-based TeX engine) and injects inline SVGs into the preview.

## Commands

```bash
npm run compile        # Build (tsc)
npm run watch          # Build in watch mode
npm run test           # Run all tests (Jest)
npm run test:watch     # Tests in watch mode
npm run test:coverage  # Tests with coverage
npm run lint           # ESLint
npx jest path/to/file.test.ts  # Run a single test file
npx vsce package       # Package .vsix for local install
```

## Architecture

### Rendering Pipeline

1. **markdown-it hook** (`extension.ts`): Replaces the `fence` renderer. For `tikz` blocks, returns cached SVG or a loading spinner and schedules a background render.
2. **Background render** (`PreviewManager.ts`): Parses all tikz blocks from the document (`DocumentParser`), checks two-level cache (L1 in-memory Map, L2 persistent `vscode.Memento`), renders uncached blocks via `node-tikzjax`.
3. **Serialized rendering**: All WASM renders go through a promise chain (`_renderChain`) since the TeX engine is single-threaded.
4. **SVG post-processing** (`svgPostProcessor.ts`): SVGO optimization, dimension normalization (72/54 dpi ratio fix), dark mode color transform.
5. **Nudge refresh**: After rendering, inserts+undoes a space to trigger VS Code to re-run markdown-it, which now finds the cached SVG.

### Key Modules

- `src/extension.ts` — Entry point, markdown-it plugin, Marp compatibility wrapper
- `src/preview/PreviewManager.ts` — Render orchestration, caching, nudge logic
- `src/core/DocumentParser.ts` — Regex extraction of tikz blocks from Markdown
- `src/core/CacheManager.ts` — Persistent cache via globalState Memento
- `src/utils/preprocessor.ts` — Source cleaning before render (NBSP, blank lines)
- `src/utils/colorTransform.ts` — SVG dark mode: black→`currentColor`, white→`var(--vscode-editor-background)`
- `src/webview/svgPostProcessor.ts` — SVGO + dimension fix + color transform

### Testing

Tests are co-located (`*.test.ts` next to source). All run in Node via `ts-jest` — no VS Code host required. Every core/utils module has tests.

### Extension Settings

Settings live under `tikzjax.*`: `invertColorsInDarkMode`, `renderTimeout`, `autoPreview`, `previewPosition`.

## Key Constraints

- `node-tikzjax` WASM engine is single-threaded; renders must be serialized.
- Cache keys are SHA-256 of trimmed TikZ source.
- The `pgfplotsset{compat=...}` version is downgraded to `1.16` due to engine limitations.
- TypeScript strict mode with all strict flags enabled (`noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`).
