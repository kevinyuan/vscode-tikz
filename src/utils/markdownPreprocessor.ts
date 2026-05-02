import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolves %!include / %!notes directives in Marp frontmatter and speaker notes.
 *
 * Frontmatter syntax (any line inside the YAML block):
 *   %!include _theme.yaml
 *
 * Speaker notes syntax (standalone line, NOT inside a comment):
 *   %!notes notes/slide1.md
 *
 * Using a non-comment line avoids a VS Code TextMate grammar bug where the
 * first <!-- is paired with the --> of the SECOND comment, greying out all
 * markdown content in between.  The preprocessor converts %!notes to a proper
 * <!-- content --> comment before Marp ever sees the source.
 *
 * File content is cached by absolute path with mtime+size validation, so
 * repeated parses are fast and edits are picked up without a manual refresh.
 */

interface FileCacheEntry {
    content: string;
    mtimeMs: number;
    size: number;
}

const FRONTMATTER_INCLUDE_LINE_RE = /^%!include\s+(.+)$/m;
/** Matches a %!notes directive line (leading/trailing whitespace allowed). */
const NOTES_DIRECTIVE_RE = /^[ \t]*%!notes[ \t]+(.+?)[ \t]*$/gm;

export class MarkdownIncludeResolver {
    private readonly _cache = new Map<string, FileCacheEntry>();

    /** Absolute paths of files resolved since the last clearTracked() call. */
    private _trackedPaths = new Set<string>();

    getTrackedPaths(): Set<string> {
        return this._trackedPaths;
    }

    /** Reset tracked paths (call before each full document resolve). */
    clearTracked(): void {
        this._trackedPaths = new Set<string>();
    }

    /** Evict a single entry so the next read picks up the updated file. */
    invalidate(filePath: string): void {
        this._cache.delete(filePath);
    }

    // ── Core ────────────────────────────────────────────────────

    /**
     * Resolve both frontmatter and notes includes.
     * Returns the processed source (unchanged if no directives are found).
     */
    resolve(src: string, baseDir: string): string {
        let out = this._resolveFrontmatter(src, baseDir);
        out = this._resolveNotes(out, baseDir);
        return out;
    }

    // ── Internal ────────────────────────────────────────────────

    /** Read a file with mtime-based cache validation. Returns null on any error. */
    private _readFile(filePath: string): string | null {
        try {
            const stat = fs.statSync(filePath);
            const cached = this._cache.get(filePath);
            if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
                return cached.content;
            }
            const content = fs.readFileSync(filePath, 'utf8');
            this._cache.set(filePath, { content, mtimeMs: stat.mtimeMs, size: stat.size });
            return content;
        } catch {
            return null;
        }
    }

    private _resolveFilePath(rawPath: string, baseDir: string): string {
        return path.isAbsolute(rawPath) ? rawPath : path.resolve(baseDir, rawPath);
    }

    _resolveFrontmatter(src: string, baseDir: string): string {
        // Quick bail-out: no frontmatter or no include directive
        if (!FRONTMATTER_INCLUDE_LINE_RE.test(src)) { return src; }

        const fmMatch = src.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*/);
        if (!fmMatch) { return src; }

        const fmBody = fmMatch[1];
        if (!FRONTMATTER_INCLUDE_LINE_RE.test(fmBody)) { return src; }

        const resolvedBody = fmBody.replace(/^%!include\s+(.+)$/mg, (_, rawFile: string) => {
            const filePath = this._resolveFilePath(rawFile.trim(), baseDir);
            this._trackedPaths.add(filePath);
            const content = this._readFile(filePath);
            if (content === null) {
                return `# markdownPreprocessor: cannot include ${rawFile.trim()}`;
            }
            return content.trim();
        });

        const fmEnd = fmMatch.index! + fmMatch[0].length;
        return '---\n' + resolvedBody + '\n---' + src.slice(fmEnd);
    }

    _resolveNotes(src: string, baseDir: string): string {
        if (!src.includes('%!notes')) { return src; }

        // Reset lastIndex before each use (regex is module-level with /g flag)
        NOTES_DIRECTIVE_RE.lastIndex = 0;
        return src.replace(NOTES_DIRECTIVE_RE, (_, rawFile: string) => {
            const filePath = this._resolveFilePath(rawFile.trim(), baseDir);
            this._trackedPaths.add(filePath);
            const content = this._readFile(filePath);
            if (content === null) {
                return `<!-- markdownPreprocessor: cannot include ${rawFile.trim()} -->`;
            }
            return `<!--\n${content.trim()}\n-->`;
        });
    }
}
