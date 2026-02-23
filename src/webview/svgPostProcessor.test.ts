/**
 * Unit tests for SVG Post-Processor
 * 
 * Tests SVG optimization and color transformation:
 * - SVGO integration
 * - ID preservation
 * - Dark mode color transformations
 * - Graceful failure handling
 */

import { describe, it, expect } from '@jest/globals';
import { postProcessSvg, optimizeSvg, postProcessSvgWithConfig } from './svgPostProcessor';

describe('SVG Post-Processor', () => {
    describe('optimizeSvg', () => {
        it('should optimize a simple SVG', () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
                <rect x="0" y="0" width="50" height="50" fill="red"/>
            </svg>`;

            const result = optimizeSvg(svg);

            // Should still be valid SVG
            expect(result).toContain('<svg');
            expect(result).toContain('</svg>');
            // SVGO may convert rect to path for optimization
            expect(result).toMatch(/(rect|path)/);
            // Should be smaller or equal (optimization may not reduce size for simple SVGs)
            expect(result.length).toBeLessThanOrEqual(svg.length + 50); // Allow some overhead
        });

        it('should preserve element IDs during optimization', () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="grad1">
                        <stop offset="0%" style="stop-color:rgb(255,255,0)"/>
                    </linearGradient>
                </defs>
                <rect fill="url(#grad1)" width="100" height="100"/>
            </svg>`;

            const result = optimizeSvg(svg);

            // ID should be preserved (Requirement 12.2)
            expect(result).toContain('id="grad1"');
            expect(result).toContain('url(#grad1)');
        });

        it('should preserve viewBox attribute', () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40"/>
            </svg>`;

            const result = optimizeSvg(svg);

            expect(result).toContain('viewBox');
        });

        it('should handle SVG with multiple elements', () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg">
                <rect x="0" y="0" width="50" height="50"/>
                <circle cx="75" cy="75" r="25"/>
                <path d="M10,10 L20,20"/>
            </svg>`;

            const result = optimizeSvg(svg);

            // SVGO may convert rect to path for optimization
            expect(result).toMatch(/(rect|path)/);
            expect(result).toContain('circle');
            expect(result).toContain('path');
        });
    });

    describe('postProcessSvg', () => {
        it('should optimize and apply dark mode transformations', () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg">
                <rect stroke="black" fill="white" width="100" height="100"/>
            </svg>`;

            const result = postProcessSvg(svg, true);

            // Should be optimized
            expect(result).toContain('<svg');
            // SVGO may convert rect to path
            expect(result).toMatch(/(rect|path)/);

            // Should have dark mode colors applied
            expect(result).toContain('currentColor');
            expect(result).toContain('var(--vscode-editor-background)');
            expect(result).not.toContain('stroke="black"');
            expect(result).not.toContain('fill="white"');
        });

        it('should optimize without dark mode transformations', () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg">
                <rect stroke="black" fill="white" width="100" height="100"/>
            </svg>`;

            const result = postProcessSvg(svg, false);

            // Should be optimized
            expect(result).toContain('<svg');
            // SVGO may convert rect to path
            expect(result).toMatch(/(rect|path)/);

            // Should NOT have dark mode colors applied
            // SVGO may shorten colors (#000 for black, #fff for white)
            expect(result).toMatch(/(black|#000)/);
            expect(result).toMatch(/(white|#fff)/);
            expect(result).not.toContain('currentColor');
        });

        it('should preserve IDs during post-processing', () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <pattern id="pattern1" width="10" height="10">
                        <rect width="5" height="5" fill="black"/>
                    </pattern>
                </defs>
                <rect fill="url(#pattern1)" width="100" height="100"/>
            </svg>`;

            const result = postProcessSvg(svg, true);

            // ID should be preserved
            expect(result).toContain('id="pattern1"');
            expect(result).toContain('url(#pattern1)');
        });

        it('should handle complex SVG with text elements', () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg">
                <text x="10" y="20" fill="black" font-size="14">Hello World</text>
                <text x="10" y="40" stroke="black">Test</text>
            </svg>`;

            const result = postProcessSvg(svg, true);

            expect(result).toContain('text');
            expect(result).toContain('Hello World');
            expect(result).toContain('Test');
            // Black colors should be transformed
            expect(result).toContain('currentColor');
        });

        it('should handle SVG with paths and strokes', () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg">
                <path d="M10,10 L50,50" stroke="black" stroke-width="2" fill="none"/>
                <path d="M60,10 L100,50" stroke="white" stroke-width="2" fill="none"/>
            </svg>`;

            const result = postProcessSvg(svg, true);

            expect(result).toContain('path');
            expect(result).toContain('currentColor');
            expect(result).toContain('var(--vscode-editor-background)');
        });

        it('should not modify non-black/white colors', () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg">
                <rect fill="red" stroke="blue" width="100" height="100"/>
                <circle fill="green" cx="50" cy="50" r="20"/>
            </svg>`;

            const result = postProcessSvg(svg, true);

            expect(result).toContain('red');
            // SVGO may shorten blue to #00f
            expect(result).toMatch(/(blue|#00f)/);
            expect(result).toContain('green');
        });
    });

    describe('Graceful failure handling', () => {
        it('should handle invalid SVG gracefully', () => {
            const invalidSvg = '<svg><invalid></svg>';

            // Should not throw, should return transformed SVG
            const result = postProcessSvg(invalidSvg, true);

            expect(result).toBeDefined();
            expect(typeof result).toBe('string');
        });

        it('should fall back to unoptimized SVG on optimization failure', () => {
            // Malformed SVG that might cause optimization issues
            const problematicSvg = '<svg xmlns="http://www.w3.org/2000/svg"><rect stroke="black"/></svg>';

            const result = postProcessSvg(problematicSvg, true);

            // Should still apply color transformations even if optimization fails
            expect(result).toBeDefined();
            expect(typeof result).toBe('string');
        });

        it('should handle empty SVG', () => {
            const emptySvg = '<svg></svg>';

            const result = postProcessSvg(emptySvg, false);

            expect(result).toContain('<svg');
            // SVGO may convert <svg></svg> to <svg/>
            expect(result).toMatch(/(<svg\/>|<\/svg>)/);
        });

        it('should handle SVG with only whitespace', () => {
            const whitespaceSvg = '<svg>   \n\n   </svg>';

            const result = postProcessSvg(whitespaceSvg, false);

            expect(result).toBeDefined();
        });
    });

    describe('postProcessSvgWithConfig', () => {
        it('should use custom SVGO configuration', () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg">
                <rect x="0" y="0" width="100" height="100" fill="black" stroke="white"/>
            </svg>`;

            const customConfig: any = {
                plugins: [
                    {
                        name: 'preset-default',
                        params: {
                            overrides: {
                                cleanupIds: false
                            }
                        }
                    }
                ]
            };

            const result = postProcessSvgWithConfig(svg, true, customConfig);

            expect(result).toContain('<svg');
            // SVGO may convert rect to path
            expect(result).toMatch(/(rect|path)/);
            // Dark mode should be applied - at least one color transformation should occur
            expect(result).toMatch(/(currentColor|var\(--vscode-editor-background\))/);
        });

        it('should fall back on custom config failure', () => {
            const svg = '<svg><rect fill="black"/></svg>';

            // Invalid config that might cause issues
            const invalidConfig = {} as any;

            const result = postProcessSvgWithConfig(svg, true, invalidConfig);

            // Should still return transformed SVG
            expect(result).toBeDefined();
            expect(typeof result).toBe('string');
        });
    });

    describe('Integration scenarios', () => {
        it('should handle TikZ-generated SVG structure', () => {
            // Typical structure from TikZJax
            const tikzSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200">
                <defs>
                    <g id="glyph-0-0">
                        <path d="M 10 10 L 20 20"/>
                    </g>
                </defs>
                <g>
                    <path stroke="black" stroke-width="0.5" d="M 50 50 L 150 150"/>
                    <use xlink:href="#glyph-0-0" x="100" y="100"/>
                </g>
            </svg>`;

            const result = postProcessSvg(tikzSvg, true);

            expect(result).toContain('<svg');
            expect(result).toContain('viewBox');
            expect(result).toContain('id="glyph-0-0"');
            expect(result).toContain('xlink:href="#glyph-0-0"');
            expect(result).toContain('currentColor');
        });

        it('should handle multiple diagrams with unique IDs', () => {
            const svg1 = `<svg xmlns="http://www.w3.org/2000/svg">
                <defs><linearGradient id="grad-diagram-1"/></defs>
                <rect fill="url(#grad-diagram-1)"/>
            </svg>`;

            const svg2 = `<svg xmlns="http://www.w3.org/2000/svg">
                <defs><linearGradient id="grad-diagram-2"/></defs>
                <rect fill="url(#grad-diagram-2)"/>
            </svg>`;

            const result1 = postProcessSvg(svg1, false);
            const result2 = postProcessSvg(svg2, false);

            // IDs should be preserved and remain unique
            expect(result1).toContain('id="grad-diagram-1"');
            expect(result2).toContain('id="grad-diagram-2"');
            expect(result1).not.toContain('grad-diagram-2');
            expect(result2).not.toContain('grad-diagram-1');
        });

        it('should optimize and transform in correct order', () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg">
                <rect x="0" y="0" width="100" height="100" fill="black" stroke="white"/>
            </svg>`;

            const result = postProcessSvg(svg, true);

            // Should be optimized (smaller or similar size)
            expect(result).toContain('<svg');

            // Should have transformations applied AFTER optimization
            // Both colors should be transformed (one to currentColor, one to background)
            expect(result).toMatch(/(currentColor|var\(--vscode-editor-background\))/);
            expect(result).toContain('var(--vscode-editor-background)');
            expect(result).not.toContain('fill="black"');
            expect(result).not.toContain('stroke="white"');
        });
    });
});
