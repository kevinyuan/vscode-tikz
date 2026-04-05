/**
 * Preprocesses TikZ source code to handle common formatting issues.
 * Removes non-breaking spaces, trims excessive whitespace, and removes empty lines.
 * 
 * Requirements: 8.1, 8.2, 8.3
 */

/**
 * Preprocesses tikz source code by:
 * - Removing non-breaking space characters (&nbsp;, \u00A0)
 * - Trimming excessive leading and trailing whitespace from lines
 * - Removing empty lines while preserving structure
 * 
 * @param source - The raw tikz source code
 * @returns The preprocessed source code
 */
export function preprocessSource(source: string): string {
    // Remove non-breaking space characters (Requirement 8.1)
    let processed = source.replace(/\u00A0/g, ' ');

    // Split into lines, trim each line, and remove empty lines (Requirements 8.2, 8.3)
    const lines = processed.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    processed = lines.join('\n');

    if (!processed) { return processed; }

    // Wrap in \begin{document}...\end{document} if not already present
    // (node-tikzjax requires a complete LaTeX document structure)
    if (!processed.includes('\\begin{document}')) {
        processed = '\\begin{document}\n' + processed + '\n\\end{document}';
    }

    return processed;
}
