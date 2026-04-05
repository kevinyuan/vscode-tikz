/**
 * SVG color transformation utility for dark mode support.
 * Transforms colors in SVG strings to support theme changes.
 * 
 * Requirements: 7.1, 7.2, 7.5
 */

/**
 * Transforms colors in an SVG string for dark mode compatibility.
 * - Replaces black colors with currentColor (inherits text color)
 * - Replaces white colors with background color variable
 * - Handles stroke, fill, and text color attributes
 * 
 * @param svg - The SVG string to transform
 * @param darkMode - Whether to apply dark mode transformations
 * @returns The transformed SVG string
 */
export function transformSvgColors(svg: string, darkMode: boolean): string {
    if (!darkMode) {
        return svg;
    }

    // Replace black/white color values in both direct SVG attributes and inline style blocks.
    // This covers TikZJax outputs where colors may be emitted as attributes or style declarations.
    let transformed = svg;
    const bgColor = 'var(--vscode-editor-background)';

    const blackPatterns = ['#000000', '#000', 'black', 'rgb\\(0,\\s*0,\\s*0\\)'];
    const whitePatterns = ['#ffffff', '#fff', 'white', 'rgb\\(255,\\s*255,\\s*255\\)'];
    const colorAttrs = ['fill', 'stroke', 'color'];

    const replaceColorAttrs = (input: string, patterns: string[], replacement: string): string => {
        let out = input;
        for (const attr of colorAttrs) {
            for (const pattern of patterns) {
                out = out.replace(new RegExp(`${attr}="${pattern}"`, 'gi'), `${attr}="${replacement}"`);
                out = out.replace(new RegExp(`${attr}='${pattern}'`, 'gi'), `${attr}="${replacement}"`);
            }
        }
        return out;
    };

    const replaceInlineStyleColors = (input: string, patterns: string[], replacement: string): string => {
        let out = input;
        for (const attr of colorAttrs) {
            for (const pattern of patterns) {
                out = out.replace(
                    new RegExp(`(${attr}\\s*:\\s*)${pattern}(\\s*;?)`, 'gi'),
                    `$1${replacement}$2`
                );
            }
        }
        return out;
    };

    transformed = replaceColorAttrs(transformed, blackPatterns, 'currentColor');
    transformed = replaceColorAttrs(transformed, whitePatterns, bgColor);

    transformed = replaceInlineStyleColors(transformed, blackPatterns, 'currentColor');
    transformed = replaceInlineStyleColors(transformed, whitePatterns, bgColor);

    // TikZJax text often relies on SVG's default black fill (without explicit fill attr).
    // In dark mode, make those text nodes inherit the editor foreground color.
    transformed = transformed.replace(/<text\b([^>]*)>/gi, (fullTag, attrs) => {
        // Keep explicit author intent untouched: only patch truly implicit text color.
        if (/\/\s*>$/.test(fullTag)) {
            return fullTag;
        }
        if (/\bfill\s*=\s*(['"]).*?\1/i.test(attrs)) {
            return fullTag;
        }
        if (/\bcolor\s*=\s*(['"]).*?\1/i.test(attrs)) {
            return fullTag;
        }
        if (/\bstyle\s*=\s*(['"])[\s\S]*?\bfill\s*:/i.test(attrs)) {
            return fullTag;
        }
        if (/\bstyle\s*=\s*(['"])[\s\S]*?\bcolor\s*:/i.test(attrs)) {
            return fullTag;
        }
        // Minimal fallback for dark themes: default black text -> current editor foreground.
        return fullTag.replace(/>$/, ' fill="currentColor">');
    });

    return transformed;
}
