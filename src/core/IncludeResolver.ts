import * as path from 'path';
import * as fs from 'fs';

/**
 * Directive pattern: %!include <path>
 * Must appear as the first non-empty line of a tikz code block.
 */
const INCLUDE_REGEX = /^%!include\s+(.+)$/m;

export interface ResolvedInclude {
    /** Absolute path to the included file */
    filePath: string;
    /** File content (the full tikz source) */
    content: string;
}

export interface IncludeError {
    /** Absolute path that was attempted */
    filePath: string;
    /** Error message */
    message: string;
}

export type IncludeResult =
    | { ok: true; value: ResolvedInclude }
    | { ok: false; error: IncludeError };

interface CacheEntry {
    content: string;
    mtimeMs: number;
    size: number;
}

/**
 * Resolves %!include directives in TikZ code blocks.
 *
 * Caches file content keyed by absolute path, but verifies freshness on
 * every resolve() call by stat'ing the file and comparing mtime + size.
 * This makes the resolver self-healing on iCloud / network drives where
 * fs.watch events are unreliable — no manual cache clear is ever needed.
 */
export class IncludeResolver {
    private readonly _fileCache = new Map<string, CacheEntry>();

    /**
     * If `source` starts with a %!include directive, resolve and return
     * the included file content.  Otherwise returns undefined (not an include block).
     *
     * Freshness is checked via fs.statSync on every call; if the file's
     * mtime or size differs from the cached entry, the file is re-read.
     *
     * @param source    Raw code block content
     * @param baseDir   Directory of the markdown file (for relative path resolution)
     */
    resolve(source: string, baseDir: string): IncludeResult | undefined {
        const firstNonEmpty = source.trim().split('\n')[0]?.trim();
        if (!firstNonEmpty) { return undefined; }

        const match = INCLUDE_REGEX.exec(firstNonEmpty);
        if (!match) { return undefined; }

        const raw = match[1].trim();
        const filePath = path.isAbsolute(raw)
            ? raw
            : path.resolve(baseDir, raw);

        try {
            const stat = fs.statSync(filePath);
            const cached = this._fileCache.get(filePath);
            if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
                return { ok: true, value: { filePath, content: cached.content } };
            }

            const content = fs.readFileSync(filePath, 'utf-8');
            this._fileCache.set(filePath, {
                content,
                mtimeMs: stat.mtimeMs,
                size: stat.size,
            });
            return { ok: true, value: { filePath, content } };
        } catch (err: any) {
            // Drop any stale cache entry on error so subsequent successful
            // reads always produce fresh content.
            this._fileCache.delete(filePath);
            const message = err?.code === 'ENOENT'
                ? `File not found: ${filePath}`
                : `Failed to read file: ${filePath} — ${err?.message ?? err}`;
            return { ok: false, error: { filePath, message } };
        }
    }

    /**
     * Explicitly drop a cached file so the next resolve() re-reads from disk.
     * Still exposed for callers (e.g. fs.watch handlers) that want to force
     * re-read without waiting for the next stat check.
     */
    invalidate(filePath: string): void {
        this._fileCache.delete(filePath);
    }

    /**
     * Clear all cached file contents.
     */
    clearCache(): void {
        this._fileCache.clear();
    }

    /**
     * Return all file paths currently tracked in cache.
     */
    get cachedPaths(): string[] {
        return [...this._fileCache.keys()];
    }
}
