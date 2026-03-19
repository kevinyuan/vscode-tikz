/**
 * Extracts GFM tables from Marp markdown and replaces them with
 * fixed-format text placeholders (e.g. MARPTABLE0001) that survive LibreOffice
 * ODP→PPTX conversion intact, enabling post-processing native table injection.
 */

export interface TableData {
    index: number;
    placeholder: string;
    headers: string[];
    rows: string[][];
    alignments: Array<'left' | 'center' | 'right'>;
}

export interface TablePreprocessResult {
    processedMarkdown: string;
    tables: TableData[];
}

/** Returns MARPTABLE0001 ... MARPTABLE9999 (1-based) */
function makePlaceholder(index: number): string {
    return 'MARPTABLE' + String(index + 1).padStart(4, '0');
}

function parseAlignment(cell: string): 'left' | 'center' | 'right' {
    const t = cell.trim();
    const l = t.startsWith(':');
    const r = t.endsWith(':');
    if (l && r) { return 'center'; }
    if (r) { return 'right'; }
    return 'left';
}

/** Parse pipe-delimited row into cells, stripping leading/trailing pipes. */
function parseRow(line: string): string[] {
    const trimmed = line.trim();
    const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
    const withoutTrail = inner.endsWith('|') ? inner.slice(0, -1) : inner;
    return withoutTrail.split('|').map(c => c.trim());
}

/** Returns true if the line is a GFM table separator row: | :--- | :---: | ---: | */
function isSeparatorRow(line: string): boolean {
    return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line.trim());
}

/** Strip common Markdown inline formatting from cell text. */
export function stripInlineMarkdown(text: string): string {
    return text
        .replace(/\*\*(.*?)\*\*/g, '$1')       // bold
        .replace(/\*(.*?)\*/g, '$1')            // italic
        .replace(/__(.*?)__/g, '$1')            // bold alt
        .replace(/_(.*?)_/g, '$1')              // italic alt
        .replace(/`([^`]+)`/g, '$1')            // inline code
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
        .replace(/~~(.*?)~~/g, '$1')            // strikethrough
        .replace(/\$([^$\n]+)\$/g, '$1')        // inline math: strip $ delimiters
        .trim();
}

/**
 * Extracts all GFM tables from Marp markdown, replacing each with a unique
 * text placeholder surrounded by blank lines. Skips tables inside fenced code blocks.
 */
export function extractAndReplaceTables(markdown: string): TablePreprocessResult {
    const tables: TableData[] = [];
    let counter = 0;

    const lines = markdown.split('\n');
    const result: string[] = [];
    let i = 0;
    let inCodeBlock = false;

    while (i < lines.length) {
        const line = lines[i];

        // Track fenced code blocks to avoid matching tables inside them
        if (/^```/.test(line.trim())) {
            inCodeBlock = !inCodeBlock;
            result.push(line);
            i++;
            continue;
        }

        // Detect start of a GFM table: pipe-delimited row followed by separator row
        if (!inCodeBlock && /\|/.test(line) && i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            if (isSeparatorRow(nextLine) && /\|/.test(line)) {
                const headers = parseRow(line);
                const separatorCells = parseRow(nextLine);
                const alignments = separatorCells.map(parseAlignment);

                // Collect data rows
                const rows: string[][] = [];
                let j = i + 2;
                while (j < lines.length && /\|/.test(lines[j]) && lines[j].trim() !== '') {
                    rows.push(parseRow(lines[j]));
                    j++;
                }

                const index = counter++;
                const placeholder = makePlaceholder(index);
                tables.push({ index, placeholder, headers, rows, alignments });

                // Replace table with placeholder, surrounded by blank lines
                result.push('');
                result.push(placeholder);
                result.push('');

                i = j;
                continue;
            }
        }

        result.push(line);
        i++;
    }

    return { processedMarkdown: result.join('\n'), tables };
}
