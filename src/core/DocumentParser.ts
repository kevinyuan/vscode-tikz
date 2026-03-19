import * as vscode from 'vscode';
import { TikzBlock } from './TikzBlock';

/**
 * Parses Markdown documents to extract TikZ code blocks.
 * 
 * The parser uses regex to find fenced code blocks with the "tikz" language
 * identifier (case-insensitive) and creates TikzBlock instances for each.
 */
export class DocumentParser {
    /**
     * Regex pattern to match tikz code blocks in Markdown.
     * 
     * Pattern explanation:
     * - ^```tikz\s*$  : Opening fence with "tikz" (case-insensitive) and optional whitespace
     * - ([\s\S]*?)    : Capture group for code block content (non-greedy, matches any character including newlines)
     * - ^```\s*$      : Closing fence with optional whitespace
     * 
     * Flags:
     * - m: Multiline mode (^ and $ match line boundaries)
     * - i: Case-insensitive (matches "tikz", "TikZ", "TIKZ", etc.)
     * - g: Global (find all matches)
     */
    private static readonly TIKZ_BLOCK_REGEX = /^```tikz\s*$([\s\S]*?)^```\s*$/mig;

    /**
     * Parses a Markdown document and extracts all TikZ code blocks.
     * 
     * @param document - The VS Code text document to parse
     * @returns An array of TikzBlock instances, one for each detected code block
     */
    parse(document: vscode.TextDocument): TikzBlock[] {
        const text = document.getText();
        const blocks: TikzBlock[] = [];

        // Reset regex state for fresh parsing
        DocumentParser.TIKZ_BLOCK_REGEX.lastIndex = 0;

        let match: RegExpExecArray | null;
        while ((match = DocumentParser.TIKZ_BLOCK_REGEX.exec(text)) !== null) {
            const fullMatch = match[0];
            const codeContent = match[1];
            const startOffset = match.index;

            // Calculate the start position (after the opening fence)
            const openingFenceEnd = startOffset + fullMatch.indexOf('\n') + 1;
            const startPosition = document.positionAt(openingFenceEnd);

            // Calculate the end position (before the closing fence)
            const closingFenceStart = startOffset + fullMatch.lastIndexOf('\n```');
            const endPosition = document.positionAt(closingFenceStart);

            const range = new vscode.Range(startPosition, endPosition);

            // Create TikzBlock with the extracted code content
            const block = new TikzBlock(codeContent, range);
            blocks.push(block);
        }

        return blocks;
    }

    /**
     * Watches a document for content changes and triggers re-parsing.
     *
     * Changes are debounced with a 500ms delay to avoid excessive parsing
     * during rapid typing. The returned disposable should be disposed when
     * the watcher is no longer needed.
     *
     * @param document - The document to watch
     * @param onChange - Callback invoked with new TikzBlock array after changes
     * @returns A disposable that stops watching when disposed
     */
    watchDocument(
        document: vscode.TextDocument,
        onChange: (blocks: TikzBlock[]) => void
    ): vscode.Disposable {
        let debounceTimer: NodeJS.Timeout | undefined;

        const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
            // Only process changes for the target document
            if (event.document.uri.toString() !== document.uri.toString()) {
                return;
            }

            // Clear existing timer
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }

            // Set new debounced timer (500ms)
            debounceTimer = setTimeout(() => {
                const blocks = this.parse(event.document);
                onChange(blocks);
            }, 500);
        });

        // Return a composite disposable that cleans up both the listener and timer
        return new vscode.Disposable(() => {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            changeListener.dispose();
        });
    }
}
