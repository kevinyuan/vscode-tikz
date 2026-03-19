/**
 * Message types for communication between extension host and webview
 * 
 * This module defines the TypeScript interfaces for bidirectional
 * communication between the extension host and webview contexts.
 * 
 * Requirements: 3.1, 3.2, 3.3
 */

/**
 * Request to render one or more TikZ blocks in the webview
 */
export interface RenderRequest {
    type: 'render';
    blocks: Array<{
        id: string;         // Unique identifier for the block
        source: string;     // TikZ source code to render
        hash: string;       // Content hash for caching
        lineNumber?: number; // Starting line number in the document
    }>;
    config: {
        invertColors: boolean;  // Whether to apply dark mode color inversion
        timeout: number;        // Render timeout in milliseconds
    };
}

/**
 * Response from webview after rendering attempt
 */
export interface RenderResponse {
    type: 'render-complete' | 'render-error';
    id: string;        // ID of the block that was rendered
    svg?: string;      // Rendered SVG (on success)
    error?: string;    // Error message (on failure)
    cached?: boolean;  // Whether result was retrieved from cache
}

/**
 * Union type of all messages sent from extension host to webview
 */
export type ExtensionToWebviewMessage = RenderRequest;

/**
 * Union type of all messages sent from webview to extension host
 */
export type WebviewToExtensionMessage = RenderResponse;
