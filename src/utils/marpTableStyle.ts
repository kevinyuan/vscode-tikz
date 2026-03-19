/**
 * Extracts table-related CSS from marp-cli HTML output at export time.
 * Parses the rendered <style> blocks (which include theme CSS + custom styles),
 * resolving CSS custom properties (var(--x)) to concrete hex colors.
 * Returns colors ready for use in PPTX <a:srgbClr val="..."/>.
 *
 * Marp scopes all CSS with a long prefix like:
 *   div#\:\$p > svg > foreignObject > section th { ... }
 * So we cannot match selectors exactly — we match by selector ending.
 */

export interface MarpTableStyle {
    headerBg:       string | null;  // 6-char hex, no #
    headerColor:    string | null;
    evenRowBg:      string | null;
    oddRowBg:       string | null;
    textColor:      string | null;  // body text color (section color)
    tableFontScale: number;         // e.g. 0.82 from `table { font-size: 0.82em }`
}

/** Fallback when no Marp CSS is found — uses PowerPoint theme colors. */
export function defaultMarpTableStyle(): MarpTableStyle {
    return { headerBg: null, headerColor: null, evenRowBg: null, oddRowBg: null, textColor: null, tableFontScale: 1.0 };
}

/** Convert a 3 or 6 char CSS hex string (without #) to 6-char uppercase hex. */
function expandHex(h: string): string {
    if (h.length === 3) { return h.split('').map(c => c + c).join(''); }
    return h.toUpperCase();
}

const NAMED_COLORS: Record<string, string> = {
    white: 'FFFFFF', black: '000000', red: 'FF0000', green: '008000',
    blue: '0000FF', gray: '808080', grey: '808080', transparent: '',
};

/** Convert a CSS color value to 6-char uppercase hex, or null if not parseable. */
function cssColorToHex(value: string): string | null {
    const v = value.trim().toLowerCase();
    if (v === 'transparent' || v === 'none') { return null; }

    // #RGB or #RRGGBB
    const hexM = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
    if (hexM) { return expandHex(hexM[1].toUpperCase()); }

    // rgb(r, g, b)
    const rgbM = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(v);
    if (rgbM) {
        return [rgbM[1], rgbM[2], rgbM[3]]
            .map(n => parseInt(n, 10).toString(16).padStart(2, '0'))
            .join('').toUpperCase();
    }

    // Named colors
    if (NAMED_COLORS[v] !== undefined) { return NAMED_COLORS[v] || null; }

    return null;
}

/** Resolve a CSS value that may contain var(--name) references. */
function resolveCssColor(value: string, vars: Record<string, string>): string | null {
    const v = value.trim();
    // var(--name) or var(--name, fallback)
    const varM = /^var\(\s*--([a-zA-Z0-9_-]+)(?:\s*,\s*([^)]+))?\s*\)$/.exec(v);
    if (varM) {
        const resolved = vars[varM[1]];
        if (resolved) { return resolveCssColor(resolved, vars); }
        if (varM[2])  { return resolveCssColor(varM[2], vars); }
        return null;
    }
    return cssColorToHex(v);
}

/** Extract CSS custom properties from anywhere in the CSS. */
function extractCssVars(css: string): Record<string, string> {
    const vars: Record<string, string> = {};
    const re = /--([a-zA-Z0-9_-]+)\s*:\s*([^;}\n]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
        vars[m[1]] = m[2].trim();
    }
    return vars;
}

/** Extract properties from a single CSS rule body: `prop: value; ...`. */
function extractProps(ruleBody: string): Record<string, string> {
    const props: Record<string, string> = {};
    const re = /([a-zA-Z-]+)\s*:\s*([^;]+);?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ruleBody)) !== null) {
        props[m[1].trim()] = m[2].trim();
    }
    return props;
}

/** Parse all non-nested CSS rules into (selector, body) pairs. */
function parseAllRules(css: string): Array<{selector: string; body: string}> {
    const rules: Array<{selector: string; body: string}> = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
        rules.push({ selector: m[1].trim(), body: m[2] });
    }
    return rules;
}

/**
 * Find merged properties from all rules whose selector ends with the given pattern.
 * Later rules in cascade order override earlier ones (last-wins merge).
 * This handles Marp's scoped selectors like `div#\:\$p > ... > section th`.
 */
function findMergedProps(rules: Array<{selector: string; body: string}>, endingPattern: RegExp): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const rule of rules) {
        // Check each comma-separated selector component
        const parts = rule.selector.split(',');
        const matches = parts.some(p => endingPattern.test(p.trim()));
        if (matches) {
            const props = extractProps(rule.body);
            Object.assign(merged, props);
        }
    }
    return merged;
}

/**
 * Extract and concatenate all <style>...</style> blocks from marp-cli HTML output.
 */
export function extractStylesFromHtml(html: string): string {
    const parts: string[] = [];
    const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
        parts.push(m[1]);
    }
    return parts.join('\n');
}

/**
 * Parse table-related CSS colors from raw CSS text (extracted from marp-cli HTML output).
 */
export function parseMarpTableStyleFromCss(css: string): MarpTableStyle {
    const vars = extractCssVars(css);
    const rules = parseAllRules(css);

    function color(props: Record<string, string>): string | null {
        const val = props['background-color'] ?? props['background'] ?? props['color'];
        return val ? resolveCssColor(val, vars) : null;
    }
    function colorProp(props: Record<string, string>, prop: string): string | null {
        const val = props[prop];
        return val ? resolveCssColor(val, vars) : null;
    }

    // th { background-color: ...; color: ...; }
    // Matches: "th", "table th", "section th", "... > section th", etc.
    const thProps = findMergedProps(rules, /\bth\s*$/);
    const headerBg    = colorProp(thProps, 'background-color') ?? colorProp(thProps, 'background');
    const headerColor = colorProp(thProps, 'color');

    // tr:nth-child(even) or tr:nth-child(2n)
    const evenProps = findMergedProps(rules, /\btr:nth-child\((?:even|2n)\)\s*$/);
    const evenRowBg = colorProp(evenProps, 'background-color') ?? colorProp(evenProps, 'background');

    // tr:nth-child(odd) or tr:nth-child(2n+1)
    const oddProps = findMergedProps(rules, /\btr:nth-child\((?:odd|2n\+1)\)\s*$/);
    const oddRowBg = colorProp(oddProps, 'background-color') ?? colorProp(oddProps, 'background');

    // section { color: ... } — body text color.
    const sectionProps = findMergedProps(rules, /\bsection(?:\[[^\]]*\])?\s*$/);
    const textColor = colorProp(sectionProps, 'color');

    // table { font-size: Nem } — scale applied to the placeholder's font size
    const tableProps = findMergedProps(rules, /\btable\s*$/);
    const tableFSVal = tableProps['font-size']?.trim() ?? '';
    let tableFontScale = 1.0;
    const emM = /^([\d.]+)em$/.exec(tableFSVal);
    if (emM) { tableFontScale = parseFloat(emM[1]); }
    const pctM = /^([\d.]+)%$/.exec(tableFSVal);
    if (pctM) { tableFontScale = parseFloat(pctM[1]) / 100; }

    void color; // suppress unused warning
    return { headerBg, headerColor, evenRowBg, oddRowBg, textColor, tableFontScale };
}

/**
 * Parse Marp table style from marp-cli HTML output.
 * Extracts all <style> blocks and resolves colors from the rendered theme.
 */
export function parseMarpTableStyleFromHtml(html: string): MarpTableStyle {
    const css = extractStylesFromHtml(html);
    if (!css.trim()) { return defaultMarpTableStyle(); }
    return parseMarpTableStyleFromCss(css);
}
