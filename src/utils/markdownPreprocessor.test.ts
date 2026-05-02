import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MarkdownIncludeResolver } from './markdownPreprocessor';

// ── Helpers ────────────────────────────────────────────────────────────────

function writeFile(dir: string, name: string, content: string): string {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
    return p;
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('MarkdownIncludeResolver', () => {
    let resolver: MarkdownIncludeResolver;
    let tmpDir: string;

    beforeEach(() => {
        resolver = new MarkdownIncludeResolver();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-include-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── Frontmatter include ───────────────────────────────────────────────

    describe('frontmatter include', () => {
        it('replaces %!include with file content', () => {
            writeFile(tmpDir, '_theme.yaml', 'theme: default\npaginate: true');
            const src = `---\nmarp: true\n%!include _theme.yaml\n---\n\n# Slide 1`;
            const out = resolver.resolve(src, tmpDir);
            expect(out).toContain('theme: default');
            expect(out).toContain('paginate: true');
            expect(out).toContain('marp: true');
            expect(out).not.toContain('%!include');
        });

        it('supports multiple include lines in frontmatter', () => {
            writeFile(tmpDir, '_a.yaml', 'theme: gaia');
            writeFile(tmpDir, '_b.yaml', 'paginate: true');
            const src = `---\nmarp: true\n%!include _a.yaml\n%!include _b.yaml\n---\n\n# Slide`;
            const out = resolver.resolve(src, tmpDir);
            expect(out).toContain('theme: gaia');
            expect(out).toContain('paginate: true');
        });

        it('preserves YAML keys declared before and after include', () => {
            writeFile(tmpDir, '_theme.yaml', 'theme: uncover');
            const src = `---\nmarp: true\n%!include _theme.yaml\nauthor: Alice\n---\n\n# Hi`;
            const out = resolver.resolve(src, tmpDir);
            expect(out).toContain('marp: true');
            expect(out).toContain('theme: uncover');
            expect(out).toContain('author: Alice');
        });

        it('resolves relative paths from baseDir', () => {
            const subDir = path.join(tmpDir, 'themes');
            writeFile(subDir, 'dark.yaml', 'backgroundColor: "#000"');
            const src = `---\nmarp: true\n%!include themes/dark.yaml\n---\n\n# Slide`;
            const out = resolver.resolve(src, tmpDir);
            expect(out).toContain('backgroundColor: "#000"');
        });

        it('handles missing file with error comment in YAML', () => {
            const src = `---\nmarp: true\n%!include _nonexistent.yaml\n---\n\n# Slide`;
            const out = resolver.resolve(src, tmpDir);
            expect(out).toContain('cannot include');
            expect(out).not.toContain('%!include _nonexistent');
        });

        it('leaves src unchanged when frontmatter has no include', () => {
            const src = `---\nmarp: true\nauthor: Bob\n---\n\n# Slide`;
            expect(resolver.resolve(src, tmpDir)).toBe(src);
        });

        it('leaves src unchanged when there is no frontmatter', () => {
            const src = `# Heading\n\nSome text.`;
            expect(resolver.resolve(src, tmpDir)).toBe(src);
        });
    });

    // ── Speaker notes include ─────────────────────────────────────────────

    describe('speaker notes include', () => {
        it('replaces %!notes line with file content wrapped in comment', () => {
            writeFile(tmpDir, 'notes/slide1.md', '# Note heading\nSome **bold** text.');
            const src = `# Slide 1\n\n%!notes notes/slide1.md\n\n---`;
            const out = resolver.resolve(src, tmpDir);
            expect(out).toContain('# Note heading');
            expect(out).toContain('**bold**');
            expect(out).not.toContain('%!notes');
            expect(out).toMatch(/<!--[\s\S]*?-->/);
        });

        it('resolves multiple %!notes directives independently', () => {
            writeFile(tmpDir, 'a.md', 'Note A');
            writeFile(tmpDir, 'b.md', 'Note B');
            const src = `# S1\n%!notes a.md\n---\n# S2\n%!notes b.md`;
            const out = resolver.resolve(src, tmpDir);
            expect(out).toContain('Note A');
            expect(out).toContain('Note B');
        });

        it('handles missing notes file with error comment', () => {
            const src = `# Slide\n%!notes missing.md`;
            const out = resolver.resolve(src, tmpDir);
            expect(out).toContain('cannot include');
            expect(out).toMatch(/<!--.*-->/);
        });

        it('leaves regular HTML comments untouched', () => {
            const src = `# Slide\n<!-- This is a regular note -->`;
            expect(resolver.resolve(src, tmpDir)).toBe(src);
        });

        it('handles leading/trailing whitespace on directive line', () => {
            writeFile(tmpDir, 'note.md', 'My note content');
            const src = `# Slide\n  %!notes  note.md  `;
            const out = resolver.resolve(src, tmpDir);
            expect(out).toContain('My note content');
        });

        it('resolves relative subdirectory paths', () => {
            writeFile(tmpDir, 'notes/deep.md', 'Deep note');
            const src = `# Slide\n%!notes notes/deep.md`;
            const out = resolver.resolve(src, tmpDir);
            expect(out).toContain('Deep note');
        });
    });

    // ── Path tracking ─────────────────────────────────────────────────────

    describe('getTrackedPaths', () => {
        it('tracks all resolved include file paths', () => {
            writeFile(tmpDir, '_theme.yaml', 'theme: default');
            writeFile(tmpDir, 'notes.md', 'Note text');
            const src = `---\nmarp: true\n%!include _theme.yaml\n---\n\n# Slide\n%!notes notes.md`;
            resolver.resolve(src, tmpDir);
            const tracked = resolver.getTrackedPaths();
            expect(tracked.size).toBe(2);
            expect(tracked.has(path.join(tmpDir, '_theme.yaml'))).toBe(true);
            expect(tracked.has(path.join(tmpDir, 'notes.md'))).toBe(true);
        });

        it('clearTracked resets the tracked set', () => {
            writeFile(tmpDir, '_theme.yaml', 'theme: default');
            resolver.resolve(`---\nmarp: true\n%!include _theme.yaml\n---\n# S`, tmpDir);
            expect(resolver.getTrackedPaths().size).toBe(1);
            resolver.clearTracked();
            expect(resolver.getTrackedPaths().size).toBe(0);
        });
    });

    // ── Caching ───────────────────────────────────────────────────────────

    describe('file caching', () => {
        it('returns updated content after invalidate', () => {
            const p = writeFile(tmpDir, '_theme.yaml', 'theme: default');
            const src = `---\nmarp: true\n%!include _theme.yaml\n---\n# S`;

            const out1 = resolver.resolve(src, tmpDir);
            expect(out1).toContain('theme: default');

            // Update file, force different mtime by waiting 1ms
            fs.writeFileSync(p, 'theme: gaia', 'utf8');
            // Touch mtime explicitly to guarantee cache miss
            const now = new Date();
            fs.utimesSync(p, now, now);

            resolver.invalidate(p);
            const out2 = resolver.resolve(src, tmpDir);
            expect(out2).toContain('theme: gaia');
        });
    });
});
