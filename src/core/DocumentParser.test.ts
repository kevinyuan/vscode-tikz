import { DocumentParser } from './DocumentParser';
import { TikzBlock } from './TikzBlock';

// Mock vscode module
const mockWorkspaceListeners: Array<(event: any) => void> = [];

jest.mock('vscode', () => ({
    Range: class Range {
        start: { line: number; character: number };
        end: { line: number; character: number };

        constructor(
            startLineOrPosition: number | { line: number; character: number },
            startCharOrPosition: number | { line: number; character: number },
            endLine?: number,
            endChar?: number
        ) {
            if (typeof startLineOrPosition === 'number' && typeof startCharOrPosition === 'number') {
                // Called with 4 numbers: (startLine, startChar, endLine, endChar)
                this.start = { line: startLineOrPosition, character: startCharOrPosition };
                this.end = { line: endLine!, character: endChar! };
            } else {
                // Called with 2 Position objects
                this.start = startLineOrPosition as { line: number; character: number };
                this.end = startCharOrPosition as { line: number; character: number };
            }
        }
    },
    workspace: {
        onDidChangeTextDocument: (listener: (event: any) => void) => {
            mockWorkspaceListeners.push(listener);
            return {
                dispose: () => {
                    const index = mockWorkspaceListeners.indexOf(listener);
                    if (index > -1) {
                        mockWorkspaceListeners.splice(index, 1);
                    }
                }
            };
        }
    },
    Disposable: class Disposable {
        constructor(private callOnDispose: () => void) { }
        dispose() {
            this.callOnDispose();
        }
    }
}), { virtual: true });

/**
 * Creates a mock VS Code TextDocument for testing.
 */
function createMockDocument(content: string, uri: string = 'file:///test.md'): any {
    const lines = content.split('\n');

    return {
        uri: { toString: () => uri },
        getText: () => content,
        positionAt: (offset: number) => {
            let currentOffset = 0;
            for (let line = 0; line < lines.length; line++) {
                const lineLength = lines[line].length + 1; // +1 for newline
                if (currentOffset + lineLength > offset || line === lines.length - 1) {
                    const character = offset - currentOffset;
                    return { line, character };
                }
                currentOffset += lineLength;
            }
            return { line: lines.length - 1, character: lines[lines.length - 1].length };
        },
        lineAt: (line: number) => ({
            text: lines[line] || '',
        }),
    };
}

/**
 * Helper to trigger mock document change events
 */
function triggerDocumentChange(document: any) {
    mockWorkspaceListeners.forEach(listener => {
        listener({ document });
    });
}

describe('DocumentParser', () => {
    let parser: DocumentParser;

    beforeEach(() => {
        parser = new DocumentParser();
    });

    describe('parse', () => {
        it('should detect a single tikz code block', () => {
            const content = `# My Document

\`\`\`tikz
\\begin{tikzpicture}
\\draw (0,0) -- (1,1);
\\end{tikzpicture}
\`\`\`

Some text after.`;

            const document = createMockDocument(content);
            const blocks = parser.parse(document);

            expect(blocks).toHaveLength(1);
            expect(blocks[0]).toBeInstanceOf(TikzBlock);
            expect(blocks[0].source).toContain('\\begin{tikzpicture}');
            expect(blocks[0].source).toContain('\\draw (0,0) -- (1,1);');
            expect(blocks[0].source).toContain('\\end{tikzpicture}');
        });

        it('should detect multiple tikz code blocks', () => {
            const content = `# Document with Multiple Blocks

\`\`\`tikz
\\begin{tikzpicture}
\\draw (0,0) -- (1,1);
\\end{tikzpicture}
\`\`\`

Some text in between.

\`\`\`tikz
\\begin{tikzpicture}
\\draw (0,0) circle (1);
\\end{tikzpicture}
\`\`\`

More text.

\`\`\`tikz
\\begin{tikzpicture}
\\node at (0,0) {Hello};
\\end{tikzpicture}
\`\`\`
`;

            const document = createMockDocument(content);
            const blocks = parser.parse(document);

            expect(blocks).toHaveLength(3);
            expect(blocks[0].source).toContain('\\draw (0,0) -- (1,1);');
            expect(blocks[1].source).toContain('\\draw (0,0) circle (1);');
            expect(blocks[2].source).toContain('\\node at (0,0) {Hello};');
        });

        it('should support case-insensitive "tikz" identifier', () => {
            const content = `
\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\`

\`\`\`TikZ
\\draw (0,0) -- (2,2);
\`\`\`

\`\`\`TIKZ
\\draw (0,0) -- (3,3);
\`\`\`

\`\`\`TiKz
\\draw (0,0) -- (4,4);
\`\`\`
`;

            const document = createMockDocument(content);
            const blocks = parser.parse(document);

            expect(blocks).toHaveLength(4);
            expect(blocks[0].source).toContain('(1,1)');
            expect(blocks[1].source).toContain('(2,2)');
            expect(blocks[2].source).toContain('(3,3)');
            expect(blocks[3].source).toContain('(4,4)');
        });

        it('should not detect non-tikz code blocks', () => {
            const content = `
\`\`\`javascript
console.log('hello');
\`\`\`

\`\`\`python
print('hello')
\`\`\`

\`\`\`latex
\\documentclass{article}
\`\`\`
`;

            const document = createMockDocument(content);
            const blocks = parser.parse(document);

            expect(blocks).toHaveLength(0);
        });

        it('should handle empty tikz code blocks', () => {
            const content = `
\`\`\`tikz
\`\`\`
`;

            const document = createMockDocument(content);
            const blocks = parser.parse(document);

            expect(blocks).toHaveLength(1);
            // Empty block will have just a newline character
            expect(blocks[0].source.trim()).toBe('');
        });

        it('should handle tikz blocks with only whitespace', () => {
            const content = `
\`\`\`tikz
   
  
\`\`\`
`;

            const document = createMockDocument(content);
            const blocks = parser.parse(document);

            expect(blocks).toHaveLength(1);
            expect(blocks[0].source).toMatch(/^\s+$/);
        });

        it('should extract correct code content without fences', () => {
            const content = `\`\`\`tikz
\\begin{tikzpicture}
\\draw (0,0) -- (1,1);
\\end{tikzpicture}
\`\`\``;

            const document = createMockDocument(content);
            const blocks = parser.parse(document);

            expect(blocks).toHaveLength(1);
            // Should not include the fence markers
            expect(blocks[0].source).not.toContain('```');
            // Should include the actual code (tikzpicture contains "tikz" so we can't test for that)
            expect(blocks[0].source).toContain('\\begin{tikzpicture}');
            expect(blocks[0].source).toContain('\\draw (0,0) -- (1,1);');
        });

        it('should generate unique IDs for each block', () => {
            const content = `
\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\`

\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\`
`;

            const document = createMockDocument(content);
            const blocks = parser.parse(document);

            expect(blocks).toHaveLength(2);
            expect(blocks[0].id).not.toBe(blocks[1].id);
        });

        it('should generate same hash for identical content', () => {
            const content = `
\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\`

\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\`
`;

            const document = createMockDocument(content);
            const blocks = parser.parse(document);

            expect(blocks).toHaveLength(2);
            expect(blocks[0].hash).toBe(blocks[1].hash);
        });

        it('should generate different hashes for different content', () => {
            const content = `
\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\`

\`\`\`tikz
\\draw (0,0) -- (2,2);
\`\`\`
`;

            const document = createMockDocument(content);
            const blocks = parser.parse(document);

            expect(blocks).toHaveLength(2);
            expect(blocks[0].hash).not.toBe(blocks[1].hash);
        });

        it('should handle complex TikZ code with multiple lines', () => {
            const content = `
\`\`\`tikz
\\begin{tikzpicture}[scale=2]
  \\draw[thick,->] (0,0) -- (1,0) node[right] {$x$};
  \\draw[thick,->] (0,0) -- (0,1) node[above] {$y$};
  \\draw[red,thick] (0,0) circle (0.5);
  \\fill[blue] (0.5,0.5) circle (0.1);
\\end{tikzpicture}
\`\`\`
`;

            const document = createMockDocument(content);
            const blocks = parser.parse(document);

            expect(blocks).toHaveLength(1);
            expect(blocks[0].source).toContain('scale=2');
            expect(blocks[0].source).toContain('node[right]');
            expect(blocks[0].source).toContain('circle (0.5)');
        });

        it('should handle tikz blocks with special characters', () => {
            const content = `
\`\`\`tikz
\\begin{tikzpicture}
  \\node {$\\alpha + \\beta = \\gamma$};
  \\draw (0,0) -- (1,1) node[midway] {$\\frac{1}{2}$};
\\end{tikzpicture}
\`\`\`
`;

            const document = createMockDocument(content);
            const blocks = parser.parse(document);

            expect(blocks).toHaveLength(1);
            expect(blocks[0].source).toContain('\\alpha');
            expect(blocks[0].source).toContain('\\frac{1}{2}');
        });

        it('should handle document with no tikz blocks', () => {
            const content = `# Regular Markdown

This is just regular text with no code blocks.

## Another Section

More text here.`;

            const document = createMockDocument(content);
            const blocks = parser.parse(document);

            expect(blocks).toHaveLength(0);
        });

        it('should handle empty document', () => {
            const content = '';

            const document = createMockDocument(content);
            const blocks = parser.parse(document);

            expect(blocks).toHaveLength(0);
        });

        it('should handle tikz block at start of document', () => {
            const content = `\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\`

Text after.`;

            const document = createMockDocument(content);
            const blocks = parser.parse(document);

            expect(blocks).toHaveLength(1);
            expect(blocks[0].source).toContain('\\draw (0,0) -- (1,1);');
        });

        it('should handle tikz block at end of document', () => {
            const content = `Text before.

\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\``;

            const document = createMockDocument(content);
            const blocks = parser.parse(document);

            expect(blocks).toHaveLength(1);
            expect(blocks[0].source).toContain('\\draw (0,0) -- (1,1);');
        });

        it('should handle consecutive tikz blocks', () => {
            const content = `\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\`
\`\`\`tikz
\\draw (0,0) -- (2,2);
\`\`\``;

            const document = createMockDocument(content);
            const blocks = parser.parse(document);

            expect(blocks).toHaveLength(2);
            expect(blocks[0].source).toContain('(1,1)');
            expect(blocks[1].source).toContain('(2,2)');
        });

        it('should preserve line numbers correctly', () => {
            const content = `Line 0
Line 1
\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\`
Line 5`;

            const document = createMockDocument(content);
            const blocks = parser.parse(document);

            expect(blocks).toHaveLength(1);
            // The code starts on line 3 (after the opening fence on line 2)
            expect(blocks[0].lineNumber).toBe(3);
        });
    });

    describe('watchDocument', () => {
        beforeEach(() => {
            // Clear any existing listeners
            mockWorkspaceListeners.length = 0;
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should trigger onChange callback when document changes', (done) => {
            const content = `\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\``;
            const document = createMockDocument(content);

            const onChange = jest.fn((blocks: TikzBlock[]) => {
                expect(blocks).toHaveLength(1);
                expect(blocks[0].source).toContain('\\draw (0,0) -- (1,1);');
                done();
            });

            const disposable = parser.watchDocument(document, onChange);

            // Trigger a change
            triggerDocumentChange(document);

            // Fast-forward time to trigger debounced callback
            jest.advanceTimersByTime(500);

            disposable.dispose();
        });

        it('should debounce changes with 500ms delay', () => {
            const content = `\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\``;
            const document = createMockDocument(content);

            const onChange = jest.fn();
            const disposable = parser.watchDocument(document, onChange);

            // Trigger multiple rapid changes
            triggerDocumentChange(document);
            jest.advanceTimersByTime(200);

            triggerDocumentChange(document);
            jest.advanceTimersByTime(200);

            triggerDocumentChange(document);
            jest.advanceTimersByTime(200);

            // At this point, 600ms have passed but onChange should not have been called yet
            // because each change resets the timer
            expect(onChange).not.toHaveBeenCalled();

            // Now advance past the debounce delay
            jest.advanceTimersByTime(300);

            // Should have been called exactly once
            expect(onChange).toHaveBeenCalledTimes(1);

            disposable.dispose();
        });

        it('should only process changes for the target document', () => {
            const content1 = `\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\``;
            const content2 = `\`\`\`tikz
\\draw (0,0) -- (2,2);
\`\`\``;

            const document1 = createMockDocument(content1, 'file:///test1.md');
            const document2 = createMockDocument(content2, 'file:///test2.md');

            const onChange = jest.fn();
            const disposable = parser.watchDocument(document1, onChange);

            // Trigger change on document2 (should be ignored)
            triggerDocumentChange(document2);
            jest.advanceTimersByTime(500);

            expect(onChange).not.toHaveBeenCalled();

            // Trigger change on document1 (should be processed)
            triggerDocumentChange(document1);
            jest.advanceTimersByTime(500);

            expect(onChange).toHaveBeenCalledTimes(1);

            disposable.dispose();
        });

        it('should re-parse document with updated content', () => {
            const initialContent = `\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\``;

            const updatedContent = `\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\`

\`\`\`tikz
\\draw (0,0) -- (2,2);
\`\`\``;

            const document = createMockDocument(initialContent);

            const onChange = jest.fn();
            const disposable = parser.watchDocument(document, onChange);

            // Update the document content
            document.getText = () => updatedContent;

            // Trigger change
            triggerDocumentChange(document);
            jest.advanceTimersByTime(500);

            expect(onChange).toHaveBeenCalledTimes(1);
            const blocks = onChange.mock.calls[0][0];
            expect(blocks).toHaveLength(2);
            expect(blocks[0].source).toContain('(1,1)');
            expect(blocks[1].source).toContain('(2,2)');

            disposable.dispose();
        });

        it('should clean up timer when disposed', () => {
            const content = `\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\``;
            const document = createMockDocument(content);

            const onChange = jest.fn();
            const disposable = parser.watchDocument(document, onChange);

            // Trigger change
            triggerDocumentChange(document);

            // Dispose before debounce completes
            jest.advanceTimersByTime(200);
            disposable.dispose();

            // Advance past debounce delay
            jest.advanceTimersByTime(400);

            // onChange should not have been called because we disposed
            expect(onChange).not.toHaveBeenCalled();
        });

        it('should clean up listener when disposed', () => {
            const content = `\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\``;
            const document = createMockDocument(content);

            const onChange = jest.fn();

            expect(mockWorkspaceListeners).toHaveLength(0);

            const disposable = parser.watchDocument(document, onChange);

            expect(mockWorkspaceListeners).toHaveLength(1);

            disposable.dispose();

            expect(mockWorkspaceListeners).toHaveLength(0);
        });

        it('should handle multiple watchers on different documents', () => {
            const content1 = `\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\``;
            const content2 = `\`\`\`tikz
\\draw (0,0) -- (2,2);
\`\`\``;

            const document1 = createMockDocument(content1, 'file:///test1.md');
            const document2 = createMockDocument(content2, 'file:///test2.md');

            const onChange1 = jest.fn();
            const onChange2 = jest.fn();

            const disposable1 = parser.watchDocument(document1, onChange1);
            const disposable2 = parser.watchDocument(document2, onChange2);

            // Trigger change on document1
            triggerDocumentChange(document1);
            jest.advanceTimersByTime(500);

            expect(onChange1).toHaveBeenCalledTimes(1);
            expect(onChange2).not.toHaveBeenCalled();

            // Trigger change on document2
            triggerDocumentChange(document2);
            jest.advanceTimersByTime(500);

            expect(onChange1).toHaveBeenCalledTimes(1);
            expect(onChange2).toHaveBeenCalledTimes(1);

            disposable1.dispose();
            disposable2.dispose();
        });

        it('should handle rapid changes and only call onChange once after debounce', () => {
            const content = `\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\``;
            const document = createMockDocument(content);

            const onChange = jest.fn();
            const disposable = parser.watchDocument(document, onChange);

            // Simulate rapid typing (10 changes in quick succession)
            for (let i = 0; i < 10; i++) {
                triggerDocumentChange(document);
                jest.advanceTimersByTime(50);
            }

            // Should not have been called yet
            expect(onChange).not.toHaveBeenCalled();

            // Advance past the debounce delay
            jest.advanceTimersByTime(500);

            // Should have been called exactly once
            expect(onChange).toHaveBeenCalledTimes(1);

            disposable.dispose();
        });

        it('should detect when tikz blocks are added', () => {
            const initialContent = `# Document

Some text.`;

            const updatedContent = `# Document

Some text.

\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\``;

            const document = createMockDocument(initialContent);

            const onChange = jest.fn();
            const disposable = parser.watchDocument(document, onChange);

            // Update the document to add a tikz block
            document.getText = () => updatedContent;

            // Trigger change
            triggerDocumentChange(document);
            jest.advanceTimersByTime(500);

            expect(onChange).toHaveBeenCalledTimes(1);
            const blocks = onChange.mock.calls[0][0];
            expect(blocks).toHaveLength(1);
            expect(blocks[0].source).toContain('\\draw (0,0) -- (1,1);');

            disposable.dispose();
        });

        it('should detect when tikz blocks are removed', () => {
            const initialContent = `\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\`

\`\`\`tikz
\\draw (0,0) -- (2,2);
\`\`\``;

            const updatedContent = `\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\``;

            const document = createMockDocument(initialContent);

            const onChange = jest.fn();
            const disposable = parser.watchDocument(document, onChange);

            // Update the document to remove a tikz block
            document.getText = () => updatedContent;

            // Trigger change
            triggerDocumentChange(document);
            jest.advanceTimersByTime(500);

            expect(onChange).toHaveBeenCalledTimes(1);
            const blocks = onChange.mock.calls[0][0];
            expect(blocks).toHaveLength(1);
            expect(blocks[0].source).toContain('(1,1)');

            disposable.dispose();
        });

        it('should detect when tikz block content is modified', () => {
            const initialContent = `\`\`\`tikz
\\draw (0,0) -- (1,1);
\`\`\``;

            const updatedContent = `\`\`\`tikz
\\draw (0,0) -- (5,5);
\`\`\``;

            const document = createMockDocument(initialContent);

            const onChange = jest.fn();
            const disposable = parser.watchDocument(document, onChange);

            // Update the document content
            document.getText = () => updatedContent;

            // Trigger change
            triggerDocumentChange(document);
            jest.advanceTimersByTime(500);

            expect(onChange).toHaveBeenCalledTimes(1);
            const blocks = onChange.mock.calls[0][0];
            expect(blocks).toHaveLength(1);
            expect(blocks[0].source).toContain('(5,5)');
            expect(blocks[0].source).not.toContain('(1,1)');

            disposable.dispose();
        });
    });
});
