import { TikzBlock } from './TikzBlock';

// Mock vscode module
jest.mock('vscode', () => ({
    Range: class Range {
        start: { line: number; character: number };
        end: { line: number; character: number };

        constructor(startLine: number, startChar: number, endLine: number, endChar: number) {
            this.start = { line: startLine, character: startChar };
            this.end = { line: endLine, character: endChar };
        }
    }
}), { virtual: true });

// Import vscode after mocking
import * as vscode from 'vscode';

describe('TikzBlock', () => {
    describe('constructor', () => {
        it('should create a TikzBlock with all required properties', () => {
            const source = '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}';
            const range = new vscode.Range(5, 0, 7, 0);

            const block = new TikzBlock(source, range);

            expect(block.id).toBeDefined();
            expect(block.id).toMatch(/^tikz-\d+-[a-z0-9]+$/);
            expect(block.source).toBe(source);
            expect(block.hash).toBeDefined();
            expect(block.hash).toHaveLength(64); // SHA-256 produces 64 hex characters
            expect(block.range).toBe(range);
            expect(block.lineNumber).toBe(5);
        });

        it('should generate unique IDs for different blocks', () => {
            const source = '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}';
            const range = new vscode.Range(0, 0, 2, 0);

            const block1 = new TikzBlock(source, range);
            const block2 = new TikzBlock(source, range);

            expect(block1.id).not.toBe(block2.id);
        });

        it('should compute the same hash for identical source code', () => {
            const source = '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}';
            const range1 = new vscode.Range(0, 0, 2, 0);
            const range2 = new vscode.Range(10, 0, 12, 0);

            const block1 = new TikzBlock(source, range1);
            const block2 = new TikzBlock(source, range2);

            expect(block1.hash).toBe(block2.hash);
        });

        it('should compute different hashes for different source code', () => {
            const source1 = '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}';
            const source2 = '\\begin{tikzpicture}\n\\draw (0,0) -- (2,2);\n\\end{tikzpicture}';
            const range = new vscode.Range(0, 0, 2, 0);

            const block1 = new TikzBlock(source1, range);
            const block2 = new TikzBlock(source2, range);

            expect(block1.hash).not.toBe(block2.hash);
        });

        it('should set lineNumber to the start line of the range', () => {
            const source = '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}';
            const range = new vscode.Range(42, 0, 44, 0);

            const block = new TikzBlock(source, range);

            expect(block.lineNumber).toBe(42);
        });
    });

    describe('equals', () => {
        it('should return true for blocks with identical source code', () => {
            const source = '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}';
            const range1 = new vscode.Range(0, 0, 2, 0);
            const range2 = new vscode.Range(10, 0, 12, 0);

            const block1 = new TikzBlock(source, range1);
            const block2 = new TikzBlock(source, range2);

            expect(block1.equals(block2)).toBe(true);
            expect(block2.equals(block1)).toBe(true);
        });

        it('should return false for blocks with different source code', () => {
            const source1 = '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}';
            const source2 = '\\begin{tikzpicture}\n\\draw (0,0) -- (2,2);\n\\end{tikzpicture}';
            const range = new vscode.Range(0, 0, 2, 0);

            const block1 = new TikzBlock(source1, range);
            const block2 = new TikzBlock(source2, range);

            expect(block1.equals(block2)).toBe(false);
            expect(block2.equals(block1)).toBe(false);
        });

        it('should return true when comparing a block with itself', () => {
            const source = '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}';
            const range = new vscode.Range(0, 0, 2, 0);

            const block = new TikzBlock(source, range);

            expect(block.equals(block)).toBe(true);
        });

        it('should handle empty source code', () => {
            const source = '';
            const range = new vscode.Range(0, 0, 0, 0);

            const block1 = new TikzBlock(source, range);
            const block2 = new TikzBlock(source, range);

            expect(block1.equals(block2)).toBe(true);
        });

        it('should be sensitive to whitespace differences', () => {
            const source1 = '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}';
            const source2 = '\\begin{tikzpicture}\n  \\draw (0,0) -- (1,1);\n\\end{tikzpicture}';
            const range = new vscode.Range(0, 0, 2, 0);

            const block1 = new TikzBlock(source1, range);
            const block2 = new TikzBlock(source2, range);

            expect(block1.equals(block2)).toBe(false);
        });
    });
});
