/**
 * Unit tests for message type definitions
 * 
 * These tests verify that message types are correctly structured
 * and can be serialized/deserialized for communication between
 * extension host and webview.
 */

import type { RenderRequest, RenderResponse } from './messages';

describe('Message Types', () => {
    describe('RenderRequest', () => {
        it('should have correct structure for single block', () => {
            const request: RenderRequest = {
                type: 'render',
                blocks: [
                    {
                        id: 'block-1',
                        source: '\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}',
                        hash: 'abc123',
                    },
                ],
                config: {
                    invertColors: false,
                    timeout: 15000,
                },
            };

            expect(request.type).toBe('render');
            expect(request.blocks).toHaveLength(1);
            expect(request.blocks[0].id).toBe('block-1');
            expect(request.config.timeout).toBe(15000);
        });

        it('should support multiple blocks', () => {
            const request: RenderRequest = {
                type: 'render',
                blocks: [
                    { id: 'block-1', source: 'source1', hash: 'hash1' },
                    { id: 'block-2', source: 'source2', hash: 'hash2' },
                    { id: 'block-3', source: 'source3', hash: 'hash3' },
                ],
                config: {
                    invertColors: true,
                    timeout: 30000,
                },
            };

            expect(request.blocks).toHaveLength(3);
            expect(request.blocks[1].id).toBe('block-2');
        });

        it('should serialize to JSON correctly', () => {
            const request: RenderRequest = {
                type: 'render',
                blocks: [{ id: 'test', source: 'test-source', hash: 'test-hash' }],
                config: { invertColors: false, timeout: 10000 },
            };

            const json = JSON.stringify(request);
            const parsed = JSON.parse(json) as RenderRequest;

            expect(parsed.type).toBe('render');
            expect(parsed.blocks[0].id).toBe('test');
            expect(parsed.config.timeout).toBe(10000);
        });
    });

    describe('RenderResponse', () => {
        it('should have correct structure for successful render', () => {
            const response: RenderResponse = {
                type: 'render-complete',
                id: 'block-1',
                svg: '<svg>...</svg>',
                cached: false,
            };

            expect(response.type).toBe('render-complete');
            expect(response.id).toBe('block-1');
            expect(response.svg).toBeDefined();
            expect(response.error).toBeUndefined();
        });

        it('should have correct structure for error response', () => {
            const response: RenderResponse = {
                type: 'render-error',
                id: 'block-2',
                error: 'Compilation failed: undefined control sequence',
            };

            expect(response.type).toBe('render-error');
            expect(response.id).toBe('block-2');
            expect(response.error).toBeDefined();
            expect(response.svg).toBeUndefined();
        });

        it('should support cached flag', () => {
            const response: RenderResponse = {
                type: 'render-complete',
                id: 'block-3',
                svg: '<svg>cached</svg>',
                cached: true,
            };

            expect(response.cached).toBe(true);
        });

        it('should serialize to JSON correctly', () => {
            const response: RenderResponse = {
                type: 'render-complete',
                id: 'test-block',
                svg: '<svg>test</svg>',
                cached: false,
            };

            const json = JSON.stringify(response);
            const parsed = JSON.parse(json) as RenderResponse;

            expect(parsed.type).toBe('render-complete');
            expect(parsed.id).toBe('test-block');
            expect(parsed.svg).toBe('<svg>test</svg>');
        });
    });

    describe('Message Round-trip', () => {
        it('should preserve data through JSON serialization', () => {
            const request: RenderRequest = {
                type: 'render',
                blocks: [
                    {
                        id: 'block-1',
                        source: '\\begin{tikzpicture}\\node {Hello};\\end{tikzpicture}',
                        hash: 'def456',
                    },
                ],
                config: {
                    invertColors: true,
                    timeout: 20000,
                },
            };

            const serialized = JSON.stringify(request);
            const deserialized = JSON.parse(serialized) as RenderRequest;

            expect(deserialized).toEqual(request);
        });

        it('should handle special characters in source code', () => {
            const request: RenderRequest = {
                type: 'render',
                blocks: [
                    {
                        id: 'special',
                        source: '\\draw (0,0) node {$\\alpha + \\beta = \\gamma$};',
                        hash: 'special-hash',
                    },
                ],
                config: { invertColors: false, timeout: 15000 },
            };

            const json = JSON.stringify(request);
            const parsed = JSON.parse(json) as RenderRequest;

            expect(parsed.blocks[0].source).toBe(request.blocks[0].source);
        });

        it('should handle empty blocks array', () => {
            const request: RenderRequest = {
                type: 'render',
                blocks: [],
                config: { invertColors: false, timeout: 15000 },
            };

            const json = JSON.stringify(request);
            const parsed = JSON.parse(json) as RenderRequest;

            expect(parsed.blocks).toEqual([]);
        });
    });
});
