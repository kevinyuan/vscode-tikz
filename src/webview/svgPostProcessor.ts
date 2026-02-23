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
                    // Preserve IDs to avoid conflicts with multiple diagrams (Requirement 12.2)
                    cleanupIds: false,
                    // Preserve viewBox for proper scaling
                    removeViewBox: false,
                }
            }
        },
        // Fix text alignment issues on different platforms (Requirement 12.4)
        {
            name: 'convertStyleToAttrs',
            params: {
                // Convert style attributes to individual attributes for better compatibility
            }
        }
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
        // Apply SVGO optimization (Requirement 12.1)
        const optimized = optimizeSvg(svg);

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
