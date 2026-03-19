/**
 * Extracts LaTeX math formulas from Marp markdown and replaces them with
 * fixed-format text placeholders (e.g. MARPMATH0001) that survive LibreOffice
 * ODP→PPTX conversion intact, enabling post-processing OMML injection.
 */

export interface ExtractedMath {
    index: number;
    placeholder: string;
    latex: string;
    isDisplay: boolean;
}

export interface MathPreprocessResult {
    processedMarkdown: string;
    formulas: ExtractedMath[];
}

/** Returns MARPMATH0001 ... MARPMATH9999 (1-based) */
function makePlaceholder(index: number): string {
    return 'MARPMATH' + String(index + 1).padStart(4, '0');
}

/**
 * Extracts all $$...$$ (display) and $...$ (inline) math from Marp markdown,
 * replacing each with a unique text placeholder. Display math placeholders are
 * surrounded by blank lines so LibreOffice places them in their own paragraph.
 *
 * Must process display math before inline to avoid double-matching $$ delimiters.
 */
export function extractAndReplaceMath(markdown: string): MathPreprocessResult {
    const formulas: ExtractedMath[] = [];
    let counter = 0;

    // Step 1: display math $$...$$ (may span lines, non-greedy)
    // Replace in one pass using a function to track positions correctly
    let processed = markdown.replace(/\$\$([\s\S]+?)\$\$/g, (_match, latex: string) => {
        const index = counter++;
        const placeholder = makePlaceholder(index);
        formulas.push({ index, placeholder, latex: latex.trim(), isDisplay: true });
        // Surround with blank lines so LibreOffice creates a separate paragraph
        return `\n\n${placeholder}\n\n`;
    });

    // Step 2: inline math $...$ (single line, non-empty, not preceded/followed by $)
    processed = processed.replace(/(?<!\$)\$(?!\$)((?:[^$\n\\]|\\[\s\S])+?)\$(?!\$)/g, (_match, latex: string) => {
        const index = counter++;
        const placeholder = makePlaceholder(index);
        formulas.push({ index, placeholder, latex: latex.trim(), isDisplay: false });
        return placeholder;
    });

    return { processedMarkdown: processed, formulas };
}
