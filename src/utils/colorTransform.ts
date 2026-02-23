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

    let transformed = svg;

    // Replace black colors with currentColor (Requirement 7.1)
    // Handle various black color formats: #000, #000000, rgb(0,0,0), black
    transformed = transformed
        .replace(/fill="#000000"/g, 'fill="currentColor"')
        .replace(/fill="#000"/g, 'fill="currentColor"')
        .replace(/fill="black"/g, 'fill="currentColor"')
        .replace(/fill="rgb\(0,\s*0,\s*0\)"/g, 'fill="currentColor"')
        .replace(/stroke="#000000"/g, 'stroke="currentColor"')
        .replace(/stroke="#000"/g, 'stroke="currentColor"')
        .replace(/stroke="black"/g, 'stroke="currentColor"')
        .replace(/stroke="rgb\(0,\s*0,\s*0\)"/g, 'stroke="currentColor"')
        .replace(/color="#000000"/g, 'color="currentColor"')
        .replace(/color="#000"/g, 'color="currentColor"')
        .replace(/color="black"/g, 'color="currentColor"')
        .replace(/color="rgb\(0,\s*0,\s*0\)"/g, 'color="currentColor"');

    // Replace white colors with background color variable (Requirement 7.2)
    // Handle various white color formats: #fff, #ffffff, rgb(255,255,255), white
    const bgColor = 'var(--vscode-editor-background)';
    transformed = transformed
        .replace(/fill="#ffffff"/gi, `fill="${bgColor}"`)
        .replace(/fill="#fff"/gi, `fill="${bgColor}"`)
        .replace(/fill="white"/g, `fill="${bgColor}"`)
        .replace(/fill="rgb\(255,\s*255,\s*255\)"/g, `fill="${bgColor}"`)
        .replace(/stroke="#ffffff"/gi, `stroke="${bgColor}"`)
        .replace(/stroke="#fff"/gi, `stroke="${bgColor}"`)
        .replace(/stroke="white"/g, `stroke="${bgColor}"`)
        .replace(/stroke="rgb\(255,\s*255,\s*255\)"/g, `stroke="${bgColor}"`)
        .replace(/color="#ffffff"/gi, `color="${bgColor}"`)
        .replace(/color="#fff"/gi, `color="${bgColor}"`)
        .replace(/color="white"/g, `color="${bgColor}"`)
        .replace(/color="rgb\(255,\s*255,\s*255\)"/g, `color="${bgColor}"`);

    return transformed;
}
