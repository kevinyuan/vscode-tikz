import * as vscode from 'vscode';
import { generateHash } from '../utils/hash';

/**
 * Represents a TikZ code block found in a Markdown document.
 * 
 * A TikzBlock encapsulates all information needed to identify, render,
 * and cache a TikZ diagram from a Markdown code block.
 */
export class TikzBlock {
    /** Unique identifier for this block */
    readonly id: string;

    /** Raw TikZ source code */
    readonly source: string;

    /** Content hash for cache key and change detection */
    readonly hash: string;

    /** Position of the code block in the document */
    readonly range: vscode.Range;

    /** Starting line number of the code block */
    readonly lineNumber: number;

    /**
     * Creates a new TikzBlock instance.
     * 
     * @param source - The raw TikZ source code
     * @param range - The position of the code block in the document
     */
    constructor(source: string, range: vscode.Range) {
        this.id = this.generateId();
        this.source = source;
        this.hash = generateHash(source.trim());
        this.range = range;
        this.lineNumber = range.start.line;
    }

    /**
     * Compares this TikzBlock with another for equality.
     * Two blocks are considered equal if they have the same content hash.
     * 
     * @param other - The other TikzBlock to compare with
     * @returns true if the blocks have the same content, false otherwise
     */
    equals(other: TikzBlock): boolean {
        return this.hash === other.hash;
    }

    /**
     * Generates a unique identifier for this block.
     * Uses timestamp and random value to ensure uniqueness.
     * 
     * @returns A unique identifier string
     */
    private generateId(): string {
        return `tikz-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
}
