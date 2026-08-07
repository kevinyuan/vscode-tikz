import * as vscode from 'vscode';
import { DocumentParser } from '../core/DocumentParser';
import { CacheManager } from '../core/CacheManager';
import { CacheEntry } from '../core/CacheEntry';
import { ExtensionConfiguration } from '../config/ConfigurationManager';
import { preprocessSource } from '../utils/preprocessor';
import { postProcessSvg } from '../webview/svgPostProcessor';
import {
    TikzRenderer,
    TikzRenderOptions,
    RenderTimeoutError,
    EngineCrashError,
} from '../render/TikzRenderer';

/** A memory-cache entry: either a rendered SVG or a recorded failure. */
export interface SvgCacheValue {
    svg?: string;
    error?: string;
    /** True while the failure is worth another attempt (timeout / engine crash). */
    retryable?: boolean;
    /** How many times this block has been attempted. */
    attempts?: number;
}

/**
 * Preview refreshes are throttled to at most one per this interval.
 *
 * Each refresh makes marp-vscode construct a brand-new Marp instance and
 * re-register every custom theme for the whole deck, so refreshing per rendered
 * block (as this used to) is O(blocks) full deck rebuilds.
 */
const NUDGE_THROTTLE_MS = 500;

/** Attempts allowed for a retryable failure before it sticks. */
const MAX_ATTEMPTS = 2;

/**
 * Manages TikZ rendering for the built-in Markdown preview.
 *
 * Rendering is delegated to {@link TikzRenderer}, which owns a worker process and
 * guarantees that only one TeX compile runs at a time (the WASM engine holds global
 * mutable state and cannot tolerate concurrency).
 */
export class PreviewManager {
    private readonly _parser: DocumentParser;
    private readonly _cacheManager: CacheManager;
    private _config: ExtensionConfiguration;
    private readonly _disposables: vscode.Disposable[] = [];

    /** In-memory SVG cache: hash → value. Bounded, but never evicts a pinned hash. */
    private readonly _svgCache = new Map<string, SvgCacheValue>();
    private static readonly MAX_MEMORY_CACHE = 256;

    /**
     * Hashes belonging to the document currently being rendered.
     *
     * Eviction skips these. Without it, a deck with more blocks than the cache
     * capacity evicts a block that the very next preview refresh asks for, which
     * schedules another render, which evicts the next block — an unbounded loop
     * of full deck re-renders.
     */
    private readonly _pinned = new Set<string>();

    private readonly _outputChannel: vscode.OutputChannel;
    private readonly _renderer: TikzRenderer;

    /** Re-entrancy guard: prevents refresh-triggered renders from stacking up. */
    private _isRendering = false;

    private _nudgeTimer: ReturnType<typeof setTimeout> | undefined;
    private _nudgePending = false;

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
        this._renderer = new TikzRenderer((msg) => this._outputChannel.appendLine(msg));
    }

    // ── Public API ────────────────────────────────────────────

    /** Look up a rendered block. Refreshes LRU recency. */
    getSvg(hash: string): SvgCacheValue | undefined {
        const value = this._svgCache.get(hash);
        if (value !== undefined) {
            // Re-insert so recency reflects actual use, not just insertion.
            this._svgCache.delete(hash);
            this._svgCache.set(hash, value);
        }
        return value;
    }

    clearMemoryCache(): void {
        this._svgCache.clear();
    }

    /**
     * Render every TikZ block in a document.
     *
     * Blocks are rendered one at a time. The preview is refreshed on a throttle so
     * diagrams still appear progressively without forcing a full Marp rebuild per
     * block.
     *
     * @returns true if any block's cached result changed.
     */
    async renderDocument(document: vscode.TextDocument): Promise<boolean> {
        if (this._isRendering) {
            this._outputChannel.appendLine('renderDocument: skipped (already rendering)');
            return false;
        }

        const blocks = this._parser.parse(document);
        if (blocks.length === 0) { return false; }

        this._isRendering = true;
        this._outputChannel.appendLine(`renderDocument: found ${blocks.length} tikz block(s)`);

        // Pin this document's blocks so none of them can be evicted mid-pass.
        this._pinned.clear();
        for (const block of blocks) { this._pinned.add(block.hash); }

        let changed = false;

        try {
            for (const block of blocks) {
                const existing = this._svgCache.get(block.hash);

                if (existing && !this._shouldRetry(existing)) {
                    continue;
                }

                if (!existing) {
                    // L2: persistent cache.
                    const cached = await this._cacheManager.get(block.hash);
                    if (cached) {
                        this._outputChannel.appendLine(`block ${block.hash.slice(0, 8)} — persistent cache hit`);
                        this._setSvgCache(block.hash, {
                            svg: this._applyPostProcessing(cached.svg, this._isDarkMode()),
                        });
                        changed = true;
                        continue;
                    }
                } else {
                    this._outputChannel.appendLine(
                        `block ${block.hash.slice(0, 8)} — retrying after ${existing.error?.slice(0, 60)}`
                    );
                }

                await this._renderSingleBlock(block.hash, block.source, existing?.attempts ?? 0);
                changed = true;

                // Throttled, so a deck of fast blocks collapses into one refresh while
                // slow blocks still surface one at a time.
                this._scheduleNudge();
            }

            this._outputChannel.appendLine(`renderDocument: done (changed=${changed})`);

            if (changed) { this._flushNudge(); }
            return changed;
        } finally {
            this._pinned.clear();
            this._isRendering = false;
        }
    }

    /** Force the Markdown preview to re-run markdown-it. */
    refreshPreview(): void {
        this._flushNudge(true);
    }

    /** Retry a single block by hash, clearing its cached result first. */
    async retryBlock(hash: string, source: string, _document: vscode.TextDocument): Promise<void> {
        this._svgCache.delete(hash);
        await this._cacheManager.invalidate(hash);
        await this._renderSingleBlock(hash, source, 0);
        this._flushNudge(true);
    }

    /** Public render entry point for the export path. Serialized with preview renders. */
    async renderTikzToSvg(source: string): Promise<string> {
        return this._renderRaw(source);
    }

    // ── Rendering ─────────────────────────────────────────────

    private async _renderSingleBlock(hash: string, source: string, priorAttempts: number): Promise<void> {
        this._outputChannel.appendLine(`block ${hash.slice(0, 8)} — rendering...`);
        try {
            const svg = await this._renderRaw(source);
            this._setSvgCache(hash, {
                svg: this._applyPostProcessing(svg, this._isDarkMode()),
            });
            await this._cacheManager.set(hash, new CacheEntry(hash, svg));
            this._outputChannel.appendLine(`block ${hash.slice(0, 8)} — render OK`);
        } catch (err: any) {
            const { message, retryable } = this._classifyError(err);
            const attempts = priorAttempts + 1;
            this._setSvgCache(hash, {
                error: message,
                retryable: retryable && attempts < MAX_ATTEMPTS,
                attempts,
            });
            this._outputChannel.appendLine(
                `block ${hash.slice(0, 8)} — render FAILED (attempt ${attempts}): ${message.slice(0, 120)}`
            );
        }
    }

    /** Preprocess and hand the source to the renderer. */
    private async _renderRaw(source: string): Promise<string> {
        let processed = preprocessSource(source);

        // node-tikzjax ships an older pgfplots; anything above 1.16 errors out.
        processed = processed.replace(
            /\\pgfplotsset\s*\{\s*compat\s*=\s*[\d.]+\s*\}/,
            '\\pgfplotsset{compat=1.16}'
        );

        const opts: TikzRenderOptions = {
            texPackages: this._detectPackages(processed),
            tikzLibraries: this._detectTikzLibraries(processed).join(','),
        };

        return this._renderer.render(processed, opts, this._config.renderTimeout || 15000);
    }

    /** Should a previously failed block be attempted again? */
    private _shouldRetry(value: SvgCacheValue): boolean {
        return value.error !== undefined
            && value.retryable === true
            && (value.attempts ?? 0) < MAX_ATTEMPTS;
    }

    /**
     * Turn a render failure into a display message plus a retry decision.
     *
     * Only timeouts and engine crashes are retryable — those are environmental. A
     * TeX compilation error is deterministic, so retrying just burns another compile.
     */
    private _classifyError(err: any): { message: string; retryable: boolean } {
        if (err instanceof RenderTimeoutError) {
            return { message: err.message, retryable: true };
        }
        if (err instanceof EngineCrashError) {
            return { message: err.message, retryable: true };
        }

        const msg = err?.message || String(err);

        const texErrorMatch = msg.match(/!(.*?)(?:\n|$)/);
        if (texErrorMatch) {
            return { message: `TeX compilation failed: ${texErrorMatch[1].trim()}`, retryable: false };
        }

        return {
            message: `TeX compilation failed. Check your LaTeX syntax.\n${msg.slice(0, 300)}`,
            retryable: false,
        };
    }

    /**
     * Insert into the memory cache, evicting the least recently used *unpinned*
     * entry when over capacity. Pinned hashes belong to the document being
     * rendered and must survive, even if that pushes past the nominal cap.
     */
    private _setSvgCache(hash: string, value: SvgCacheValue): void {
        this._svgCache.delete(hash);
        this._svgCache.set(hash, value);

        if (this._svgCache.size <= PreviewManager.MAX_MEMORY_CACHE) { return; }

        for (const key of this._svgCache.keys()) {
            if (this._svgCache.size <= PreviewManager.MAX_MEMORY_CACHE) { break; }
            if (this._pinned.has(key)) { continue; }
            this._svgCache.delete(key);
        }
    }

    private _detectPackages(source: string): Record<string, string> {
        const packages: Record<string, string> = {};
        const regex = /\\usepackage(?:\[([^\]]*)\])?\{([^}]+)\}/g;
        let match;
        while ((match = regex.exec(source)) !== null) {
            packages[match[2].trim()] = match[1] || '';
        }
        return packages;
    }

    private _detectTikzLibraries(source: string): string[] {
        const libs: string[] = [];
        const regex = /\\usetikzlibrary\{([^}]+)\}/g;
        let match;
        while ((match = regex.exec(source)) !== null) {
            libs.push(...match[1].split(',').map(s => s.trim()).filter(Boolean));
        }
        return libs;
    }

    // ── Preview refresh ───────────────────────────────────────

    /**
     * Request a preview refresh, throttled to one per {@link NUDGE_THROTTLE_MS}.
     */
    private _scheduleNudge(): void {
        this._nudgePending = true;
        if (this._nudgeTimer) { return; }

        this._nudgeTimer = setTimeout(() => {
            this._nudgeTimer = undefined;
            if (this._nudgePending) {
                this._nudgePending = false;
                void vscode.commands.executeCommand('markdown.preview.refresh');
            }
        }, NUDGE_THROTTLE_MS);
    }

    /** Run any pending refresh now. With `force`, refresh even if none is pending. */
    private _flushNudge(force = false): void {
        if (this._nudgeTimer) {
            clearTimeout(this._nudgeTimer);
            this._nudgeTimer = undefined;
        }
        if (this._nudgePending || force) {
            this._nudgePending = false;
            void vscode.commands.executeCommand('markdown.preview.refresh');
        }
    }

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
        await vscode.commands.executeCommand('markdown.showPreviewToSide', document.uri);
        await this.renderDocument(document);
    }

    updateConfiguration(config: ExtensionConfiguration): void {
        this._config = config;
    }

    async resetEngine(): Promise<void> {
        this._renderer.reset();
        this._svgCache.clear();
        this._outputChannel.appendLine('Engine reset');
    }

    dispose(): void {
        if (this._nudgeTimer) { clearTimeout(this._nudgeTimer); }
        this._renderer.dispose();
        for (const d of this._disposables) { d.dispose(); }
        this._disposables.length = 0;
        this._outputChannel.dispose();
    }
}
