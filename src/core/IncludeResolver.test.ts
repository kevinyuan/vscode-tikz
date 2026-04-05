import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IncludeResolver } from './IncludeResolver';

describe('IncludeResolver', () => {
    let resolver: IncludeResolver;
    let tmpDir: string;

    beforeEach(() => {
        resolver = new IncludeResolver();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikz-include-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeTikzFile(name: string, content: string): string {
        const filePath = path.join(tmpDir, name);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf-8');
        return filePath;
    }

    describe('resolve', () => {
        it('should return undefined for non-include source', () => {
            const source = '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}';
            expect(resolver.resolve(source, tmpDir)).toBeUndefined();
        });

        it('should return undefined for empty source', () => {
            expect(resolver.resolve('', tmpDir)).toBeUndefined();
            expect(resolver.resolve('   \n  \n  ', tmpDir)).toBeUndefined();
        });

        it('should resolve %!include with relative path', () => {
            const tikzContent = '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}';
            writeTikzFile('diagram.tikz', tikzContent);

            const result = resolver.resolve('%!include diagram.tikz', tmpDir);
            expect(result).toBeDefined();
            expect(result!.ok).toBe(true);
            if (result!.ok) {
                expect(result!.value.content).toBe(tikzContent);
                expect(result!.value.filePath).toBe(path.join(tmpDir, 'diagram.tikz'));
            }
        });

        it('should resolve %!include with relative path in subdirectory', () => {
            const tikzContent = '\\draw (0,0) circle (1);';
            writeTikzFile('diagrams/circuit.tikz', tikzContent);

            const result = resolver.resolve('%!include diagrams/circuit.tikz', tmpDir);
            expect(result).toBeDefined();
            expect(result!.ok).toBe(true);
            if (result!.ok) {
                expect(result!.value.content).toBe(tikzContent);
            }
        });

        it('should resolve %!include with absolute path', () => {
            const tikzContent = '\\node {hello};';
            const filePath = writeTikzFile('abs.tikz', tikzContent);

            const result = resolver.resolve(`%!include ${filePath}`, '/some/other/dir');
            expect(result).toBeDefined();
            expect(result!.ok).toBe(true);
            if (result!.ok) {
                expect(result!.value.content).toBe(tikzContent);
            }
        });

        it('should handle leading whitespace before directive', () => {
            const tikzContent = '\\draw (0,0) -- (1,1);';
            writeTikzFile('test.tikz', tikzContent);

            // Source with leading blank lines
            const result = resolver.resolve('\n  \n%!include test.tikz', tmpDir);
            expect(result).toBeDefined();
            expect(result!.ok).toBe(true);
        });

        it('should handle extra whitespace in directive', () => {
            const tikzContent = '\\draw (0,0) -- (1,1);';
            writeTikzFile('test.tikz', tikzContent);

            const result = resolver.resolve('%!include   test.tikz  ', tmpDir);
            expect(result).toBeDefined();
            expect(result!.ok).toBe(true);
            if (result!.ok) {
                expect(result!.value.content).toBe(tikzContent);
            }
        });

        it('should return error for missing file', () => {
            const result = resolver.resolve('%!include nonexistent.tikz', tmpDir);
            expect(result).toBeDefined();
            expect(result!.ok).toBe(false);
            if (!result!.ok) {
                expect(result!.error.message).toContain('File not found');
                expect(result!.error.message).toContain('nonexistent.tikz');
            }
        });

        it('should not treat %!include in middle of source as directive', () => {
            const source = '\\draw (0,0) -- (1,1);\n%!include foo.tikz\n\\draw (2,2) -- (3,3);';
            expect(resolver.resolve(source, tmpDir)).toBeUndefined();
        });

        it('should not match %include (without !)', () => {
            expect(resolver.resolve('%include foo.tikz', tmpDir)).toBeUndefined();
        });

        it('should not match %%!include', () => {
            // This would match the regex since we only check the first non-empty line
            // but %%!include is not our directive — let's verify
            const source = '%%!include foo.tikz';
            expect(resolver.resolve(source, tmpDir)).toBeUndefined();
        });
    });

    describe('caching', () => {
        it('should cache file content after first read', () => {
            const tikzContent = '\\draw (0,0) -- (1,1);';
            const filePath = writeTikzFile('cached.tikz', tikzContent);

            // First resolve
            const result1 = resolver.resolve('%!include cached.tikz', tmpDir);
            expect(result1!.ok).toBe(true);

            // Modify file on disk
            fs.writeFileSync(filePath, 'modified content', 'utf-8');

            // Second resolve should return cached content
            const result2 = resolver.resolve('%!include cached.tikz', tmpDir);
            expect(result2!.ok).toBe(true);
            if (result2!.ok) {
                expect(result2!.value.content).toBe(tikzContent); // still original
            }
        });

        it('should re-read file after invalidate', () => {
            const tikzContent = '\\draw (0,0) -- (1,1);';
            const filePath = writeTikzFile('invalidate.tikz', tikzContent);

            // First resolve
            resolver.resolve('%!include invalidate.tikz', tmpDir);

            // Modify and invalidate
            const newContent = '\\draw (0,0) -- (9,9);';
            fs.writeFileSync(filePath, newContent, 'utf-8');
            resolver.invalidate(filePath);

            // Should now return new content
            const result = resolver.resolve('%!include invalidate.tikz', tmpDir);
            expect(result!.ok).toBe(true);
            if (result!.ok) {
                expect(result!.value.content).toBe(newContent);
            }
        });

        it('should clear all cache entries', () => {
            writeTikzFile('a.tikz', 'content a');
            writeTikzFile('b.tikz', 'content b');

            resolver.resolve('%!include a.tikz', tmpDir);
            resolver.resolve('%!include b.tikz', tmpDir);
            expect(resolver.cachedPaths).toHaveLength(2);

            resolver.clearCache();
            expect(resolver.cachedPaths).toHaveLength(0);
        });

        it('should report cached paths', () => {
            writeTikzFile('x.tikz', 'x');
            resolver.resolve('%!include x.tikz', tmpDir);

            expect(resolver.cachedPaths).toContain(path.join(tmpDir, 'x.tikz'));
        });
    });
});
