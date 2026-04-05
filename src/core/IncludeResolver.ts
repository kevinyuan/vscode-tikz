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

/**
 * Resolves %!include directives in TikZ code blocks.
 *
 * Maintains a per-file content cache so unchanged files are not re-read
 * on every markdown parse cycle.  Call `invalidate(filePath)` when a
 * file-system watcher detects a change.
 */
export class IncludeResolver {
    /** filePath → cached content */
    private readonly _fileCache = new Map<string, string>();

    /**
     * If `source` starts with a %!include directive, resolve and return
     * the included file content.  Otherwise returns undefined (not an include block).
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

        // Check in-memory cache first
        const cached = this._fileCache.get(filePath);
        if (cached !== undefined) {
            return { ok: true, value: { filePath, content: cached } };
        }

        // Read from disk
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            this._fileCache.set(filePath, content);
            return { ok: true, value: { filePath, content } };
        } catch (err: any) {
            const message = err?.code === 'ENOENT'
                ? `File not found: ${filePath}`
                : `Failed to read file: ${filePath} — ${err?.message ?? err}`;
            return { ok: false, error: { filePath, message } };
        }
    }

    /**
     * Invalidate a cached file so the next resolve() re-reads from disk.
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
