import { PreviewManager } from './PreviewManager';
import { RenderTimeoutError, EngineCrashError } from '../render/TikzRenderer';

/** Commands invoked via vscode.commands.executeCommand, in order. */
const executedCommands: string[] = [];

jest.mock('vscode', () => ({
    Uri: { file: (p: string) => ({ fsPath: p, toString: () => `file://${p}` }) },
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    window: {
        createOutputChannel: () => ({ appendLine: () => undefined, dispose: () => undefined }),
        activeColorTheme: { kind: 1 },
    },
    commands: {
        executeCommand: (cmd: string) => {
            executedCommands.push(cmd);
            return Promise.resolve();
        },
    },
}), { virtual: true });

/** Records every source handed to the engine so we can count real compiles. */
const renderedSources: string[] = [];
/** Sources that should fail, mapped to the error the fake engine throws. */
const scriptedFailures = new Map<string, Error>();

jest.mock('../render/TikzRenderer', () => {
    class RenderTimeoutError extends Error {
        constructor(ms: number) { super(`Render timed out after ${ms}ms`); this.name = 'RenderTimeoutError'; }
    }
    class EngineCrashError extends Error {
        constructor(d: string) { super(`TeX engine stopped unexpectedly (${d})`); this.name = 'EngineCrashError'; }
    }
    return {
        RenderTimeoutError,
        EngineCrashError,
        TikzRenderer: class {
            async render(source: string): Promise<string> {
                renderedSources.push(source);
                // preprocessSource wraps the block, so match on the marker substring.
                for (const [marker, failure] of scriptedFailures) {
                    if (source.includes(marker)) { throw failure; }
                }
                return `<svg data-src="${source.trim()}"></svg>`;
            }
            reset(): void { /* no-op */ }
            dispose(): void { /* no-op */ }
        },
    };
});

// postProcessSvg pulls in svgo; the identity stub keeps these tests focused.
jest.mock('../webview/svgPostProcessor', () => ({
    postProcessSvg: (svg: string) => svg,
}));

/** In-memory stand-in for the persistent cache. */
class FakeCacheManager {
    private readonly store = new Map<string, { hash: string; svg: string }>();
    /** Counts L2 lookups so we can detect thrashing. */
    reads = 0;

    async get(hash: string) {
        this.reads++;
        return this.store.get(hash);
    }
    async set(hash: string, entry: { hash: string; svg: string }) {
        this.store.set(hash, entry);
    }
    async invalidate(hash: string) { this.store.delete(hash); }
}

/** Minimal parser stub returning fixed blocks. */
class FakeParser {
    constructor(public blocks: Array<{ hash: string; source: string }>) { }
    parse() { return this.blocks; }
}

function makeManager(blocks: Array<{ hash: string; source: string }>) {
    const parser = new FakeParser(blocks);
    const cache = new FakeCacheManager();
    const manager = new PreviewManager(
        { fsPath: '/x' } as any,
        parser as any,
        cache as any,
        { renderTimeout: 15000 } as any
    );
    return { manager, parser, cache };
}

function makeBlocks(count: number) {
    return Array.from({ length: count }, (_, i) => ({ hash: `hash${i}`, source: `tikz-${i}` }));
}

const anyDoc = {} as any;

beforeEach(() => {
    executedCommands.length = 0;
    renderedSources.length = 0;
    scriptedFailures.clear();
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

describe('PreviewManager memory cache', () => {
    it('keeps every block of the current document resident, even past the nominal cap', async () => {
        // Regression: with a fixed-capacity cache, a document larger than the cache
        // evicted a block that the next preview refresh immediately asked for, which
        // scheduled another render, which evicted the next block — forever.
        const blocks = makeBlocks(400); // > MAX_MEMORY_CACHE (256)
        const { manager } = makeManager(blocks);

        await manager.renderDocument(anyDoc);

        const resident = blocks.filter(b => manager.getSvg(b.hash)?.svg !== undefined);
        expect(resident).toHaveLength(400);
    });

    it('renders nothing new on a second pass over an oversized document', async () => {
        const blocks = makeBlocks(400);
        const { manager, cache } = makeManager(blocks);

        await manager.renderDocument(anyDoc);
        const compilesAfterFirstPass = renderedSources.length;
        const readsAfterFirstPass = cache.reads;

        const changed = await manager.renderDocument(anyDoc);

        expect(changed).toBe(false);
        expect(renderedSources).toHaveLength(compilesAfterFirstPass);
        expect(cache.reads).toBe(readsAfterFirstPass);
    });

    it('evicts unpinned entries from other documents once over capacity', async () => {
        const first = makeBlocks(200);
        const { manager, parser } = makeManager(first);
        await manager.renderDocument(anyDoc);

        // Switch to a different document; its blocks are pinned, the old ones are not.
        const second = Array.from({ length: 200 }, (_, i) => ({ hash: `other${i}`, source: `other-${i}` }));
        parser.blocks = second;
        await manager.renderDocument(anyDoc);

        expect(second.every(b => manager.getSvg(b.hash)?.svg !== undefined)).toBe(true);
        const survivingFromFirst = first.filter(b => manager.getSvg(b.hash) !== undefined).length;
        expect(survivingFromFirst).toBeLessThan(first.length);
    });
});

describe('PreviewManager failure handling', () => {
    it('retries a timeout once, then stops', async () => {
        scriptedFailures.set('tikz-0', new RenderTimeoutError(15000));
        const { manager } = makeManager(makeBlocks(1));

        await manager.renderDocument(anyDoc);
        expect(renderedSources).toHaveLength(1);

        // Second pass: the failure is retryable, so it is attempted again.
        await manager.renderDocument(anyDoc);
        expect(renderedSources).toHaveLength(2);

        // Third pass: attempts are exhausted, so the error sticks and no compile runs.
        const changed = await manager.renderDocument(anyDoc);
        expect(renderedSources).toHaveLength(2);
        expect(changed).toBe(false);
        expect(manager.getSvg('hash0')?.error).toContain('timed out');
    });

    it('retries an engine crash', async () => {
        scriptedFailures.set('tikz-0', new EngineCrashError('signal SIGKILL'));
        const { manager } = makeManager(makeBlocks(1));

        await manager.renderDocument(anyDoc);
        await manager.renderDocument(anyDoc);

        expect(renderedSources).toHaveLength(2);
    });

    it('does not retry a LaTeX error', async () => {
        // Deterministic — retrying only burns another multi-second compile.
        scriptedFailures.set('tikz-0', new Error('! Undefined control sequence.\nl.5 \\bogus'));
        const { manager } = makeManager(makeBlocks(1));

        await manager.renderDocument(anyDoc);
        await manager.renderDocument(anyDoc);

        expect(renderedSources).toHaveLength(1);
        expect(manager.getSvg('hash0')?.error).toContain('Undefined control sequence');
    });

    it('a failing block does not block the ones after it', async () => {
        scriptedFailures.set('tikz-1', new Error('! Undefined control sequence.'));
        const { manager } = makeManager(makeBlocks(4));

        await manager.renderDocument(anyDoc);

        expect(manager.getSvg('hash0')?.svg).toBeDefined();
        expect(manager.getSvg('hash1')?.error).toBeDefined();
        expect(manager.getSvg('hash2')?.svg).toBeDefined();
        expect(manager.getSvg('hash3')?.svg).toBeDefined();
    });
});

describe('PreviewManager preview refreshes', () => {
    const refreshCount = () =>
        executedCommands.filter(c => c === 'markdown.preview.refresh').length;

    it('coalesces a batch of fast blocks into a single refresh', async () => {
        // Regression: refreshing per block made marp-vscode rebuild the whole deck
        // (new Marp instance + every custom theme) once per diagram.
        const { manager } = makeManager(makeBlocks(50));

        await manager.renderDocument(anyDoc);
        jest.runOnlyPendingTimers();

        expect(refreshCount()).toBe(1);
    });

    it('does not refresh when nothing changed', async () => {
        const { manager } = makeManager(makeBlocks(3));

        await manager.renderDocument(anyDoc);
        jest.runOnlyPendingTimers();
        const afterFirstPass = refreshCount();

        await manager.renderDocument(anyDoc);
        jest.runOnlyPendingTimers();

        expect(refreshCount()).toBe(afterFirstPass);
    });

    it('refreshes on demand', () => {
        const { manager } = makeManager(makeBlocks(1));
        manager.refreshPreview();
        expect(refreshCount()).toBe(1);
    });
});
