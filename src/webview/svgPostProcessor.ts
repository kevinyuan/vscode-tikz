/**
 * SVG Post-Processor for webview
 * 
 * Optimizes and transforms rendered SVG diagrams:
 * - Applies SVGO optimization
 * - Transforms colors for dark mode
 * - Handles optimization failures gracefully
 * - Preserves element IDs to avoid conflicts
 * 
 * Requirements: 12.1, 12.2, 12.4, 12.5
 */

import { optimize, Config } from 'svgo';
import { transformSvgColors } from '../utils/colorTransform';

/**
 * Configuration for SVGO optimization
 * Preserves IDs and applies platform-specific fixes
 */
const SVGO_CONFIG: Config = {
    plugins: [
        {
            name: 'preset-default',
            params: {
                overrides: {
                    // Preserve IDs to avoid conflicts with multiple diagrams
                    cleanupIds: false,
                    // Preserve viewBox for proper scaling
                    removeViewBox: false,
                    // Disable path optimizations that degrade rendering quality
                    // (cause uneven stroke widths and jagged curves)
                    convertPathData: false,
                    mergePaths: false,
                    convertTransform: false,
                    // Preserve shape primitives for crisp rendering
                    convertShapeToPath: false,
                }
            }
        },
    ]
};

/**
 * Post-processes an SVG string with optimization and color transformation
 * 
 * @param svg - The raw SVG string from TikZJax
 * @param darkMode - Whether to apply dark mode color transformations
 * @returns The optimized and transformed SVG string
 */
export function postProcessSvg(svg: string, darkMode: boolean): string {
    try {
        // Apply SVGO optimization
        let optimized = optimizeSvg(svg);

        // Fix SVG dimensions to match viewBox so 1 SVG unit = 1 CSS pixel.
        // node-tikzjax outputs width/height ~1.333x the viewBox dimensions,
        // causing fractional stroke widths and uneven rendering.
        optimized = fixSvgDimensions(optimized);

        // Apply color transformations if in dark mode
        const transformed = transformSvgColors(optimized, darkMode);

        return transformed;
    } catch (error) {
        // Handle optimization failures gracefully (Requirement 12.5)
        console.warn('SVG optimization failed, using unoptimized SVG:', error);

        // Fall back to unoptimized SVG with color transformations
        return transformSvgColors(svg, darkMode);
    }
}

/**
 * Optimizes an SVG string using SVGO
 * 
 * @param svg - The SVG string to optimize
 * @returns The optimized SVG string
 * @throws Error if optimization fails
 */
export function optimizeSvg(svg: string): string {
    const result = optimize(svg, SVGO_CONFIG);
    return result.data;
}

/**
 * Fixes SVG width/height to match the viewBox dimensions exactly.
 * node-tikzjax outputs width/height ~1.333x the viewBox (72/54 dpi ratio),
 * causing stroke-width values to render at fractional CSS pixels (e.g. 0.8 → 1.067),
 * which produces uneven borders and jagged curves.
 */
function fixSvgDimensions(svg: string): string {
    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    if (!viewBoxMatch) { return svg; }

    const parts = viewBoxMatch[1].trim().split(/\s+/);
    if (parts.length !== 4) { return svg; }

    const vbWidth = parts[2];
    const vbHeight = parts[3];

    // Replace width="..." and height="..." with viewBox dimensions (pt units)
    let result = svg.replace(/(<svg[^>]*?\s)width="[^"]*"/, `$1width="${vbWidth}pt"`);
    result = result.replace(/(<svg[^>]*?\s)height="[^"]*"/, `$1height="${vbHeight}pt"`);

    return result;
}

/**
 * Post-processes an SVG with custom SVGO configuration
 * Useful for testing or special cases
 * 
 * @param svg - The SVG string to process
 * @param darkMode - Whether to apply dark mode transformations
 * @param config - Custom SVGO configuration
 * @returns The processed SVG string
 */
export function postProcessSvgWithConfig(
    svg: string,
    darkMode: boolean,
    config: Config
): string {
    try {
        const result = optimize(svg, config);
        return transformSvgColors(result.data, darkMode);
    } catch (error) {
        console.warn('SVG optimization with custom config failed:', error);
        return transformSvgColors(svg, darkMode);
    }
}
