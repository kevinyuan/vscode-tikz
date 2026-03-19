# Memory Leak Fixes Applied

## 1. _renderChain promise chain (PreviewManager)
- Problem: `.then()` chains grow unboundedly, each capturing prior promise in closure
- Fix: Reset chain to `promise.then(() => {}, () => {})` after each render

## 2. _svgCache unbounded growth (PreviewManager)
- Problem: Map never evicts entries; each unique TikZ hash adds permanently
- Fix: LRU eviction via `_setSvgCache()`, capped at 64 entries (Map insertion order)

## 3. Timeout promise leak (PreviewManager._renderTikzToSvg)
- Problem: setTimeout never cleared when render succeeds before timeout
- Fix: `clearTimeout()` in `finally` block after `Promise.race`

## 4. lastMarkdownDocument reference (extension.ts)
- Problem: Holds TextDocument reference after close, preventing GC
- Fix: Clear on `onDidCloseTextDocument`

## 5. Persistent cache unbounded (CacheManager)
- Problem: globalState index grows forever across sessions
- Fix: `evictIfNeeded()` caps at 128 entries, removes oldest on insert
