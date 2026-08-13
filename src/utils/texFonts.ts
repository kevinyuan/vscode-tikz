import * as fs from 'fs';
import * as path from 'path';

/**
 * Embeds TeX fonts into standalone SVG files.
 *
 * node-tikzjax emits SVG that references TeX fonts by name and embeds no glyph
 * outlines:
 *
 *     <text font-family="cmmi10">®</text>
 *
 * TeX fonts are not Unicode-encoded — a character sits at its position in the
 * font rather than at its Unicode codepoint. `\alpha` is emitted as U+00AE,
 * `\sum` as U+0050, `\leq` as U+2219. Rendered with the real font those are a
 * Greek alpha, a summation sign and a ≤; rendered with any fallback font they
 * appear literally, as `®`, `P`, `∙` — mojibake.
 *
 * In the Markdown preview the fonts are supplied page-wide by
 * `media/tex-fonts/tex-fonts-marp-vscode.css`. That does not help exported diagrams: those
 * are written as separate `.svg` files and referenced with `<img src="...">`,
 * and an SVG loaded as an image is an isolated document that cannot reach the
 * embedding page's fonts. Such a file has to carry its own fonts.
 */

/** Cache of base64-encoded font payloads, keyed by family name. */
const fontDataCache = new Map<string, string | null>();

/** Extract the distinct `font-family` values an SVG references. */
export function collectFontFamilies(svg: string): string[] {
    const families = new Set<string>();
    for (const match of svg.matchAll(/font-family="([^"]+)"/g)) {
        // A family list ("cmr10, serif") is possible in principle; take each part.
        for (const part of match[1].split(',')) {
            const name = part.trim().replace(/^['"]|['"]$/g, '');
            if (name) { families.add(name); }
        }
    }
    return [...families];
}

/** Read a font file and base64-encode it, remembering misses as well as hits. */
function loadFontData(fontDir: string, family: string): string | null {
    if (fontDataCache.has(family)) {
        return fontDataCache.get(family) ?? null;
    }

    // Guard against a family name reaching outside the font directory.
    if (!/^[A-Za-z0-9_-]+$/.test(family)) {
        fontDataCache.set(family, null);
        return null;
    }

    let data: string | null = null;
    try {
        data = fs.readFileSync(path.join(fontDir, `${family}.ttf`)).toString('base64');
    } catch {
        // Not a TeX font (e.g. an author-specified "sans-serif") — nothing to embed.
        data = null;
    }

    fontDataCache.set(family, data);
    return data;
}

/**
 * Return `svg` with `@font-face` rules for every TeX font it references, each
 * carrying the font as a data URI so the file renders correctly on its own.
 *
 * Returns the SVG unchanged when it references no embeddable font.
 *
 * @param fontDir Directory holding the `.ttf` files.
 */
export function embedTexFonts(svg: string, fontDir: string): string {
    const families = collectFontFamilies(svg);
    if (families.length === 0) { return svg; }

    const faces: string[] = [];
    for (const family of families) {
        const data = loadFontData(fontDir, family);
        if (!data) { continue; }
        faces.push(
            `@font-face{font-family:"${family}";` +
            `src:url("data:font/ttf;base64,${data}") format("truetype");}`
        );
    }

    if (faces.length === 0) { return svg; }

    // CDATA keeps the base64 payload safe from XML entity parsing.
    const styleBlock = `<defs><style type="text/css">/*<![CDATA[*/${faces.join('')}/*]]>*/</style></defs>`;

    // Insert immediately after the opening <svg ...> tag.
    const openTag = svg.match(/<svg\b[^>]*>/);
    if (!openTag) { return svg; }

    const insertAt = openTag.index! + openTag[0].length;
    return svg.slice(0, insertAt) + styleBlock + svg.slice(insertAt);
}

/** Drop cached font payloads. Intended for tests. */
export function clearFontCache(): void {
    fontDataCache.clear();
}
