/**
 * Unit tests for SVG color transformation utility
 */

import { transformSvgColors } from './colorTransform';

describe('transformSvgColors', () => {
    describe('when darkMode is false', () => {
        it('should return the SVG unchanged', () => {
            const svg = '<svg fill="#000000" stroke="#ffffff"></svg>';
            const result = transformSvgColors(svg, false);
            expect(result).toBe(svg);
        });
    });

    describe('when darkMode is true', () => {
        describe('black color transformations', () => {
            it('should replace fill="#000000" with currentColor', () => {
                const svg = '<rect fill="#000000" />';
                const result = transformSvgColors(svg, true);
                expect(result).toBe('<rect fill="currentColor" />');
            });

            it('should replace fill="#000" with currentColor', () => {
                const svg = '<rect fill="#000" />';
                const result = transformSvgColors(svg, true);
                expect(result).toBe('<rect fill="currentColor" />');
            });

            it('should replace fill="black" with currentColor', () => {
                const svg = '<rect fill="black" />';
                const result = transformSvgColors(svg, true);
                expect(result).toBe('<rect fill="currentColor" />');
            });

            it('should replace fill="rgb(0,0,0)" with currentColor', () => {
                const svg = '<rect fill="rgb(0,0,0)" />';
                const result = transformSvgColors(svg, true);
                expect(result).toBe('<rect fill="currentColor" />');
            });

            it('should replace stroke="#000000" with currentColor', () => {
                const svg = '<line stroke="#000000" />';
                const result = transformSvgColors(svg, true);
                expect(result).toBe('<line stroke="currentColor" />');
            });

            it('should replace stroke="#000" with currentColor', () => {
                const svg = '<line stroke="#000" />';
                const result = transformSvgColors(svg, true);
                expect(result).toBe('<line stroke="currentColor" />');
            });

            it('should replace stroke="black" with currentColor', () => {
                const svg = '<line stroke="black" />';
                const result = transformSvgColors(svg, true);
                expect(result).toBe('<line stroke="currentColor" />');
            });

            it('should replace color="#000000" with currentColor', () => {
                const svg = '<text color="#000000">Text</text>';
                const result = transformSvgColors(svg, true);
                expect(result).toBe('<text color="currentColor">Text</text>');
            });
        });

        describe('white color transformations', () => {
            const bgColor = 'var(--vscode-editor-background)';

            it('should replace fill="#ffffff" with background variable', () => {
                const svg = '<rect fill="#ffffff" />';
                const result = transformSvgColors(svg, true);
                expect(result).toBe(`<rect fill="${bgColor}" />`);
            });

            it('should replace fill="#FFFFFF" (uppercase) with background variable', () => {
                const svg = '<rect fill="#FFFFFF" />';
                const result = transformSvgColors(svg, true);
                expect(result).toBe(`<rect fill="${bgColor}" />`);
            });

            it('should replace fill="#fff" with background variable', () => {
                const svg = '<rect fill="#fff" />';
                const result = transformSvgColors(svg, true);
                expect(result).toBe(`<rect fill="${bgColor}" />`);
            });

            it('should replace fill="#FFF" (uppercase) with background variable', () => {
                const svg = '<rect fill="#FFF" />';
                const result = transformSvgColors(svg, true);
                expect(result).toBe(`<rect fill="${bgColor}" />`);
            });

            it('should replace fill="white" with background variable', () => {
                const svg = '<rect fill="white" />';
                const result = transformSvgColors(svg, true);
                expect(result).toBe(`<rect fill="${bgColor}" />`);
            });

            it('should replace fill="rgb(255,255,255)" with background variable', () => {
                const svg = '<rect fill="rgb(255,255,255)" />';
                const result = transformSvgColors(svg, true);
                expect(result).toBe(`<rect fill="${bgColor}" />`);
            });

            it('should replace stroke="#ffffff" with background variable', () => {
                const svg = '<line stroke="#ffffff" />';
                const result = transformSvgColors(svg, true);
                expect(result).toBe(`<line stroke="${bgColor}" />`);
            });

            it('should replace stroke="white" with background variable', () => {
                const svg = '<line stroke="white" />';
                const result = transformSvgColors(svg, true);
                expect(result).toBe(`<line stroke="${bgColor}" />`);
            });

            it('should replace color="#ffffff" with background variable', () => {
                const svg = '<text color="#ffffff">Text</text>';
                const result = transformSvgColors(svg, true);
                expect(result).toBe(`<text color="${bgColor}">Text</text>`);
            });
        });

        describe('multiple color attributes', () => {
            it('should handle multiple black and white colors in the same SVG', () => {
                const svg = '<svg><rect fill="#000" stroke="#fff" /><circle fill="white" stroke="black" /></svg>';
                const result = transformSvgColors(svg, true);
                const bgColor = 'var(--vscode-editor-background)';
                expect(result).toBe(
                    `<svg><rect fill="currentColor" stroke="${bgColor}" /><circle fill="${bgColor}" stroke="currentColor" /></svg>`
                );
            });

            it('should preserve other colors unchanged', () => {
                const svg = '<rect fill="#ff0000" stroke="#00ff00" />';
                const result = transformSvgColors(svg, true);
                expect(result).toBe('<rect fill="#ff0000" stroke="#00ff00" />');
            });
        });

        describe('edge cases', () => {
            it('should handle empty SVG string', () => {
                const result = transformSvgColors('', true);
                expect(result).toBe('');
            });

            it('should handle SVG with no color attributes', () => {
                const svg = '<svg><rect width="100" height="100" /></svg>';
                const result = transformSvgColors(svg, true);
                expect(result).toBe(svg);
            });

            it('should handle rgb with spaces', () => {
                const svg = '<rect fill="rgb(0, 0, 0)" />';
                const result = transformSvgColors(svg, true);
                expect(result).toBe('<rect fill="currentColor" />');
            });

            it('should handle rgb with extra spaces', () => {
                const svg = '<rect fill="rgb(255,  255,  255)" />';
                const result = transformSvgColors(svg, true);
                expect(result).toBe('<rect fill="var(--vscode-editor-background)" />');
            });
        });
    });
});
