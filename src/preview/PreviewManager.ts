import * as vscode from 'vscode';
import { DocumentParser } from '../core/DocumentParser';
import { CacheManager } from '../core/CacheManager';
import { CacheEntry } from '../core/CacheEntry';
import { ExtensionConfiguration } from '../config/ConfigurationManager';
import { preprocessSource } from '../utils/preprocessor';
import { postProcessSvg } from '../webview/svgPostProcessor';

/**
 * Manages TikZ rendering for the built-in Markdown preview.
 * Uses a serialization lock to ensure only one tex2svg call runs at a time
 * (node-tikzjax WASM engine is single-threaded and cannot handle concurrency).
 */
export class PreviewManager {
    private readonly _parser: DocumentParser;
    private readonly _cacheManager: CacheManager;
    private _config: ExtensionConfiguration;
    private readonly _disposables: vscode.Disposable[] = [];

    private _tikzjaxLoaded = false;
    private _tikzjaxLoadPromise: Promise<void> | null = null;

    /** In-memory SVG cache: hash → { svg?, error? }. Capped at MAX_MEMORY_CACHE entries (LRU). */
    private readonly _svgCache = new Map<string, { svg?: string; error?: string }>();
    private static readonly MAX_MEMORY_CACHE = 64;

    private readonly _outputChannel: vscode.OutputChannel;

    /** Serialization chain: all tex2svg calls are queued through this */
    private _renderChain: Promise<void> = Promise.resolve();

    /** Re-entrancy guard: prevents nudge-triggered doc changes from re-entering renderDocument */
    private _isRendering = false;

    constructor(
        _extensionUri: vscode.Uri,
        parser: DocumentParser,
        cacheManager: CacheManager,
        config: ExtensionConfiguration
    ) {
        this._parser = parser;
        this._cacheManager = cacheManager;
        this._config = config;
        this._outputChannel = vscode.window.createOutputChannel('TikZJax Renderer');
    }

    // ── Public API ────────────────────────────────────────────

    getSvg(hash: string): { svg?: string; error?: string } | undefined {
        return this._svgCache.get(hash);
    }

    clearMemoryCache(): void {
        this._svgCache.clear();
    }

    /**
     * Render all TikZ blocks in a document. Blocks are rendered sequentially
     * (serialized) to avoid corrupting the WASM TeX engine. After each block
     * completes, the preview is nudged so diagrams appear one by one.
     * A re-entrancy guard prevents nudge-triggered doc changes from starting
     * a new render cycle.
     */
    async renderDocument(document: vscode.TextDocument): Promise<void> {
        // Re-entrancy guard: if we're already rendering, skip
        if (this._isRendering) {
            this._outputChannel.appendLine('renderDocument: skipped (already rendering)');
            return;
        }

        const blocks = this._parser.parse(document);
        if (blocks.length === 0) { return; }

        this._isRendering = true;
        this._outputChannel.appendLine(`renderDocument: found ${blocks.length} tikz block(s)`);

        try {
            let renderedCount = 0;

            for (const block of blocks) {
                // Skip blocks already in memory cache
                if (this._svgCache.has(block.hash)) {
                    this._outputChannel.appendLine(`block ${block.hash.slice(0, 8)} — already cached`);
                    continue;
                }

                // Check persistent cache
                const cached = await this._cacheManager.get(block.hash);
                if (cached) {
                    this._outputChannel.appendLine(`block ${block.hash.slice(0, 8)} — found in persistent cache`);
                    const darkMode = this._isDarkMode();
                    const processed = this._applyPostProcessing(cached.svg, darkMode);
                    this._setSvgCache(block.hash, { svg: processed });
                    renderedCount++;
                    // Nudge after each cached block so it appears immediately
                    await this._nudgeDocument(document);
                    continue;
                }

                // Render via node-tikzjax (serialized through the chain)
                await this._renderSingleBlock(block.hash, block.source);
                renderedCount++;

                // Nudge after each rendered block so it appears immediately
                this._outputChannel.appendLine(`→ nudging after block ${block.hash.slice(0, 8)}`);
                await this._nudgeDocument(document);
            }

            this._outputChannel.appendLine(`renderDocument: done, rendered ${renderedCount} new block(s)`);

            // Always nudge at end so speaker notes and other non-TikZ edits (which produce
            // zero per-block nudges when all blocks are memory-cached) still refresh the preview.
            await this._nudgeDocument(document);
        } finally {
            this._isRendering = false;
        }
    }

    /**
     * Retry rendering a single block by hash. Clears its cache entry first.
     */
    async retryBlock(hash: string, source: string, document: vscode.TextDocument): Promise<void> {
        this._svgCache.delete(hash);
        await this._cacheManager.invalidate(hash);
        await this._renderSingleBlock(hash, source);
        await this._nudgeDocument(document);
    }

    /**
     * Render a single block, serialized through the render chain.
     * Stores result (svg or error) in memory cache and persistent cache.
     */
    private async _renderSingleBlock(hash: string, source: string): Promise<void> {
        // Chain this render after any currently running render
        const renderPromise = this._renderChain.then(async () => {
            this._outputChannel.appendLine(`block ${hash.slice(0, 8)} — rendering...`);
            try {
                const svg = await this._renderTikzToSvg(source);
                const darkMode = this._isDarkMode();
                const processed = this._applyPostProcessing(svg, darkMode);
                this._setSvgCache(hash, { svg: processed });

                // Persist to cache
                const entry = new CacheEntry(hash, svg);
                await this._cacheManager.set(hash, entry);

                this._outputChannel.appendLine(`block ${hash.slice(0, 8)} — render OK`);
            } catch (err: any) {
                const errorMsg = this._extractTexError(err);
                this._setSvgCache(hash, { error: errorMsg });
                this._outputChannel.appendLine(`block ${hash.slice(0, 8)} — render FAILED: ${errorMsg.slice(0, 120)}`);
            }
        });

        // Reset the chain to a resolved promise to avoid unbounded closure chain growth
        this._renderChain = renderPromise.then(() => {}, () => {});

        // Wait for this block's render to complete
        await renderPromise;
    }

    /**
     * Set an entry in the in-memory SVG cache with LRU eviction.
     */
    private _setSvgCache(hash: string, value: { svg?: string; error?: string }): void {
        // Delete first so re-insertion moves it to the end (Map preserves insertion order)
        this._svgCache.delete(hash);
        this._svgCache.set(hash, value);

        // Evict oldest entries if over capacity
        while (this._svgCache.size > PreviewManager.MAX_MEMORY_CACHE) {
            const oldest = this._svgCache.keys().next().value;
            if (oldest !== undefined) {
                this._svgCache.delete(oldest);
            }
        }
    }

    /**
     * Public render method for export — serialized through the render chain.
     */
    async renderTikzToSvg(source: string): Promise<string> {
        let result: string;
        const renderPromise = this._renderChain.then(async () => {
            result = await this._renderTikzToSvg(source);
        });
        this._renderChain = renderPromise.then(() => {}, () => {});
        await renderPromise;
        return result!;
    }

    /**
     * Render TikZ source to SVG using node-tikzjax.
     * Handles preprocessing, pgfplots compat downgrade, and timeout.
     */
    private async _renderTikzToSvg(source: string): Promise<string> {
        await this._ensureTikzjaxLoaded();

        const tex2svg = (await import('node-tikzjax')).default;

        let processed = preprocessSource(source);

        // Downgrade pgfplots compat to 1.16 max (node-tikzjax limitation)
        processed = processed.replace(
            /\\pgfplotsset\s*\{\s*compat\s*=\s*[\d.]+\s*\}/,
            '\\pgfplotsset{compat=1.16}'
        );

        const timeout = this._config.renderTimeout || 15000;

        const svgPromise = tex2svg(processed, {
            showConsole: false,
            texPackages: this._detectPackages(processed),
            tikzLibraries: this._detectTikzLibraries(processed).join(','),
        });

        let timer: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error(`Render timed out after ${timeout}ms`)), timeout);
        });

        try {
            const svg = await Promise.race([svgPromise, timeoutPromise]);
            return svg;
        } finally {
            clearTimeout(timer!);
        }
    }

    /**
     * Detect \\usepackage directives and return as package map.
     */
    private _detectPackages(source: string): Record<string, string> {
        const packages: Record<string, string> = {};
        const regex = /\\usepackage(?:\[([^\]]*)\])?\{([^}]+)\}/g;
        let match;
        while ((match = regex.exec(source)) !== null) {
            const options = match[1] || '';
            const pkgName = match[2].trim();
            packages[pkgName] = options;
        }
        return packages;
    }

    /**
     * Detect \\usetikzlibrary directives.
     */
    private _detectTikzLibraries(source: string): string[] {
        const libs: string[] = [];
        const regex = /\\usetikzlibrary\{([^}]+)\}/g;
        let match;
        while ((match = regex.exec(source)) !== null) {
            const names = match[1].split(',').map(s => s.trim()).filter(Boolean);
            libs.push(...names);
        }
        return libs;
    }

    /**
     * Extract a human-readable error message from a TeX compilation error.
     */
    private _extractTexError(err: any): string {
        const msg = err?.message || String(err);

        // Look for specific TeX error patterns
        const texErrorMatch = msg.match(/!(.*?)(?:\n|$)/);
        if (texErrorMatch) {
            return `TeX compilation failed: ${texErrorMatch[1].trim()}`;
        }

        if (msg.includes('timed out')) {
            return msg;
        }

        return `TeX compilation failed. Check your LaTeX syntax.\n${msg.slice(0, 300)}`;
    }

    /**
     * Ensure node-tikzjax is loaded (one-time initialization).
     */
    private async _ensureTikzjaxLoaded(): Promise<void> {
        if (this._tikzjaxLoaded) { return; }
        if (this._tikzjaxLoadPromise) { return this._tikzjaxLoadPromise; }

        this._tikzjaxLoadPromise = (async () => {
            this._outputChannel.appendLine('Loading node-tikzjax...');
            // Just importing triggers the WASM load
            await import('node-tikzjax');
            this._tikzjaxLoaded = true;
            this._outputChannel.appendLine('node-tikzjax loaded');
        })();

        return this._tikzjaxLoadPromise;
    }

    /**
     * Nudge the document to force the Markdown preview to re-render.
     */
    private async _nudgeDocument(_document: vscode.TextDocument): Promise<void> {
        await vscode.commands.executeCommand('markdown.preview.refresh');
    }

    /**
     * Apply SVG post-processing (optimization + dark mode color transform).
     */
    private _applyPostProcessing(svg: string, darkMode: boolean): string {
        try {
            return postProcessSvg(svg, darkMode);
        } catch {
            return svg;
        }
    }

    private _isDarkMode(): boolean {
        const kind = vscode.window.activeColorTheme.kind;
        return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
    }

    // ── Commands / lifecycle ──────────────────────────────────

    async createOrShowPreview(document: vscode.TextDocument): Promise<void> {
        // Open the built-in Markdown preview
        await vscode.commands.executeCommand('markdown.showPreviewToSide', document.uri);
        // Trigger rendering
        await this.renderDocument(document);
    }

    updateConfiguration(config: ExtensionConfiguration): void {
        this._config = config;
    }

    async resetEngine(): Promise<void> {
        this._tikzjaxLoaded = false;
        this._tikzjaxLoadPromise = null;
        this._svgCache.clear();
        this._outputChannel.appendLine('Engine reset');
    }

    dispose(): void {
        for (const d of this._disposables) { d.dispose(); }
        this._disposables.length = 0;
        this._outputChannel.dispose();
    }
}
