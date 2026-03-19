/**
 * Unit tests for TikZJax patching utility
 * 
 * Tests verify that the patches are correctly generated and applied.
 * Requirements: 11.2, 11.3, 11.4
 */

import { generateTikzJaxPatches, generatePatchScriptTag } from './tikzjaxPatcher';

describe('TikZJax Patcher', () => {
    describe('generateTikzJaxPatches', () => {
        it('should generate valid JavaScript code', () => {
            const patches = generateTikzJaxPatches();

            expect(patches).toBeTruthy();
            expect(typeof patches).toBe('string');
            expect(patches.length).toBeGreaterThan(0);
        });

        it('should include timeout mechanism patch', () => {
            const patches = generateTikzJaxPatches(10000);

            // Check for timeout-related code
            expect(patches).toContain('Promise.race');
            expect(patches).toContain('setTimeout');
            expect(patches).toContain('10000');
            expect(patches).toContain('timeout exceeded');
        });

        it('should include cleanup function exposure patch', () => {
            const patches = generateTikzJaxPatches();

            // Check for cleanup function
            expect(patches).toContain('__tikzjaxCleanup');
            expect(patches).toContain('texWorker');
            expect(patches).toContain('terminate');
            expect(patches).toContain('disconnect');
        });

        it('should include error display patch', () => {
            const patches = generateTikzJaxPatches();

            // Check for error display replacement
            expect(patches).toContain('createElement');
            expect(patches).toContain('tikzjax-error');
            expect(patches).toContain('replaceChild');
            expect(patches).toContain('onerror');
        });

        it('should use custom timeout value', () => {
            const customTimeout = 30000;
            const patches = generateTikzJaxPatches(customTimeout);

            expect(patches).toContain(customTimeout.toString());
        });

        it('should use default timeout when not specified', () => {
            const patches = generateTikzJaxPatches();

            // Default timeout is 15000ms
            expect(patches).toContain('15000');
        });

        it('should wrap code in IIFE', () => {
            const patches = generateTikzJaxPatches();

            // Check for immediately invoked function expression
            expect(patches).toContain('(function()');
            expect(patches).toContain('})();');
        });

        it('should preserve original texify properties', () => {
            const patches = generateTikzJaxPatches();

            expect(patches).toContain('Object.keys(originalTexify)');
            expect(patches).toContain('hasOwnProperty');
        });

        it('should handle worker termination errors gracefully', () => {
            const patches = generateTikzJaxPatches();

            expect(patches).toContain('try');
            expect(patches).toContain('catch');
            expect(patches).toContain('console.warn');
        });

        it('should style error div appropriately', () => {
            const patches = generateTikzJaxPatches();

            expect(patches).toContain('border:');
            expect(patches).toContain('background-color:');
            expect(patches).toContain('color:');
            expect(patches).toContain('padding:');
            expect(patches).toContain('tikzjax-error');
        });
    });

    describe('generatePatchScriptTag', () => {
        it('should generate valid script tag', () => {
            const scriptTag = generatePatchScriptTag();

            expect(scriptTag).toContain('<script>');
            expect(scriptTag).toContain('</script>');
        });

        it('should include patches in script tag', () => {
            const scriptTag = generatePatchScriptTag(20000);

            expect(scriptTag).toContain('Promise.race');
            expect(scriptTag).toContain('__tikzjaxCleanup');
            expect(scriptTag).toContain('createElement');
            expect(scriptTag).toContain('20000');
        });

        it('should use custom timeout in script tag', () => {
            const customTimeout = 25000;
            const scriptTag = generatePatchScriptTag(customTimeout);

            expect(scriptTag).toContain(customTimeout.toString());
        });
    });

    describe('Patch Integration', () => {
        it('should generate patches that can be evaluated as JavaScript', () => {
            const patches = generateTikzJaxPatches();

            // This should not throw a syntax error
            expect(() => {
                new Function(patches);
            }).not.toThrow();
        });

        it('should generate script tag that contains valid JavaScript', () => {
            const scriptTag = generatePatchScriptTag();

            // Extract the JavaScript code from the script tag
            const jsCode = scriptTag.replace('<script>', '').replace('</script>', '');

            // This should not throw a syntax error
            expect(() => {
                new Function(jsCode);
            }).not.toThrow();
        });
    });

    describe('Error Handling', () => {
        it('should handle missing texify function gracefully', () => {
            const patches = generateTikzJaxPatches();

            // Check that the code checks for texify existence
            expect(patches).toContain('typeof window.texify');
        });

        it('should handle missing worker gracefully in cleanup', () => {
            const patches = generateTikzJaxPatches();

            // Check for conditional worker termination
            expect(patches).toContain('if (window.texWorker)');
        });

        it('should handle missing observer gracefully in cleanup', () => {
            const patches = generateTikzJaxPatches();

            // Check for conditional observer disconnection
            expect(patches).toContain('if (window.tikzjaxObserver)');
        });
    });

    describe('Timeout Behavior', () => {
        it('should reject with timeout error message', () => {
            const patches = generateTikzJaxPatches();

            expect(patches).toContain('TikZ rendering timeout exceeded');
            expect(patches).toContain('reject');
        });

        it('should use Promise.race for timeout enforcement', () => {
            const patches = generateTikzJaxPatches();

            expect(patches).toContain('Promise.race');
            expect(patches).toContain('timeoutPromise');
            expect(patches).toContain('renderPromise');
        });
    });

    describe('Cleanup Functionality', () => {
        it('should expose cleanup function on window object', () => {
            const patches = generateTikzJaxPatches();

            expect(patches).toContain('window.__tikzjaxCleanup');
        });

        it('should terminate worker in cleanup', () => {
            const patches = generateTikzJaxPatches();

            expect(patches).toContain('texWorker.terminate()');
            expect(patches).toContain('window.texWorker = null');
        });

        it('should disconnect observer in cleanup', () => {
            const patches = generateTikzJaxPatches();

            expect(patches).toContain('tikzjaxObserver.disconnect()');
            expect(patches).toContain('window.tikzjaxObserver = null');
        });

        it('should clear cache in cleanup', () => {
            const patches = generateTikzJaxPatches();

            expect(patches).toContain('window.tikzjaxCache = null');
        });
    });

    describe('Error Display', () => {
        it('should intercept img element creation', () => {
            const patches = generateTikzJaxPatches();

            expect(patches).toContain("tagName.toLowerCase() === 'img'");
        });

        it('should create error div with appropriate styling', () => {
            const patches = generateTikzJaxPatches();

            expect(patches).toContain('tikzjax-error');
            expect(patches).toContain('#ff4444');
            expect(patches).toContain('#ffeeee');
            expect(patches).toContain('#cc0000');
        });

        it('should replace img with error div on error', () => {
            const patches = generateTikzJaxPatches();

            expect(patches).toContain('replaceChild');
            expect(patches).toContain('parentNode');
        });

        it('should extract error message from img attributes', () => {
            const patches = generateTikzJaxPatches();

            expect(patches).toContain('element.alt');
            expect(patches).toContain('element.title');
            expect(patches).toContain('TikZ rendering failed');
        });

        it('should call original error handler if exists', () => {
            const patches = generateTikzJaxPatches();

            expect(patches).toContain('originalOnError');
            expect(patches).toContain('originalOnError.call');
        });
    });
});
