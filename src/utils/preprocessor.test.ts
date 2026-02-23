import { preprocessSource } from './preprocessor';

describe('preprocessSource', () => {
    test('removes non-breaking space characters', () => {
        const source = 'Hello\u00A0World\u00A0Test';
        const result = preprocessSource(source);
        expect(result).toBe('Hello World Test');
        expect(result).not.toContain('\u00A0');
    });

    test('trims leading whitespace from lines', () => {
        const source = '   \\begin{tikzpicture}\n    \\draw (0,0) -- (1,1);';
        const result = preprocessSource(source);
        expect(result).toBe('\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);');
    });

    test('trims trailing whitespace from lines', () => {
        const source = '\\begin{tikzpicture}   \n\\draw (0,0) -- (1,1);   ';
        const result = preprocessSource(source);
        expect(result).toBe('\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);');
    });

    test('removes empty lines', () => {
        const source = '\\begin{tikzpicture}\n\n\\draw (0,0) -- (1,1);\n\n\\end{tikzpicture}';
        const result = preprocessSource(source);
        expect(result).toBe('\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}');
    });

    test('handles multiple consecutive empty lines', () => {
        const source = 'line1\n\n\n\nline2';
        const result = preprocessSource(source);
        expect(result).toBe('line1\nline2');
    });

    test('handles mixed whitespace issues', () => {
        const source = '  \\begin{tikzpicture}  \n\n   \\draw\u00A0(0,0)\u00A0--\u00A0(1,1);   \n\n  \\end{tikzpicture}  ';
        const result = preprocessSource(source);
        expect(result).toBe('\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}');
    });

    test('preserves intentional whitespace within LaTeX commands', () => {
        const source = '\\node at (0,0) {Hello World};';
        const result = preprocessSource(source);
        expect(result).toBe('\\node at (0,0) {Hello World};');
    });

    test('handles empty string', () => {
        const source = '';
        const result = preprocessSource(source);
        expect(result).toBe('');
    });

    test('handles string with only whitespace', () => {
        const source = '   \n\n   \n   ';
        const result = preprocessSource(source);
        expect(result).toBe('');
    });

    test('handles string with only non-breaking spaces', () => {
        const source = '\u00A0\u00A0\u00A0';
        const result = preprocessSource(source);
        expect(result).toBe('');
    });
});
