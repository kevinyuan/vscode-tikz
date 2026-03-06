import * as vscode from 'vscode';
import { generateHash } from '../utils/hash';

interface SvgGetter {
    (hash: string): { svg?: string; error?: string } | undefined;
}

/**
 * WebviewViewProvider that renders Marp slide thumbnails in a sidebar panel.
 * Uses @marp-team/marp-core to render real Marp HTML, then scales each slide
 * down to thumbnail size. TikZ code blocks are replaced with cached SVGs.
 */
export class MarpSlideThumbnails implements vscode.WebviewViewProvider {
    public static readonly viewType = 'tikzMarpThumbnails';

    private _view?: vscode.WebviewView;
    private _document?: vscode.TextDocument;
    private _pendingUpdate?: ReturnType<typeof setTimeout>;
    private _getSvg: SvgGetter;

    constructor(_extensionUri: vscode.Uri, getSvg: SvgGetter) {
        this._getSvg = getSvg;
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };

        webviewView.webview.onDidReceiveMessage(msg => {
            if (msg.type === 'goToSlide') {
                vscode.commands.executeCommand('tikzjax.goToSlide', msg.line);
            }
        });

        this._updateWebview();
    }

    update(document: vscode.TextDocument): void {
        this._document = document;
        if (this._pendingUpdate) { clearTimeout(this._pendingUpdate); }
        this._pendingUpdate = setTimeout(() => this._updateWebview(), 300);
    }

    private _updateWebview(): void {
        if (!this._view) { return; }

        const doc = this._document;
        if (!doc || doc.languageId !== 'markdown') {
            this._view.webview.html = '<html><body><p style="color:#888;padding:12px;">Open a Marp markdown file to see slide thumbnails.</p></body></html>';
            return;
        }

        const text = doc.getText();
        if (!text.match(/^---\s*\n[\s\S]*?marp:\s*true/m)) {
            this._view.webview.html = '<html><body><p style="color:#888;padding:12px;">Not a Marp file.</p></body></html>';
            return;
        }

        const slideLines = this._getSlideLineNumbers(text);
        const marpHtml = this._renderMarp(text);
        this._view.webview.html = this._getHtml(marpHtml, slideLines);
    }

    /** Get the line number where each slide starts (for click navigation). */
    private _getSlideLineNumbers(text: string): number[] {
        const lines = text.split('\n');
        const slideLines: number[] = [];

        // Skip frontmatter
        let inFrontmatter = false;
        let frontmatterEnd = 0;
        for (let i = 0; i < lines.length; i++) {
            if (i === 0 && lines[i].trim() === '---') {
                inFrontmatter = true;
                continue;
            }
            if (inFrontmatter && lines[i].trim() === '---') {
                frontmatterEnd = i;
                break;
            }
        }

        // First slide starts after frontmatter
        slideLines.push(frontmatterEnd + 1);

        for (let i = frontmatterEnd + 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                slideLines.push(i);
            }
        }

        return slideLines;
    }

    /** Replace tikz code blocks with cached SVGs, then render with Marp. */
    private _renderMarp(text: string): { slidesHtml: string[]; css: string } {
        // Replace tikz code blocks with cached SVG placeholders before Marp renders
        const processed = text.replace(
            /```tikz\s*\n([\s\S]*?)```/g,
            (_match, source: string) => {
                const hash = generateHash(source.trim());
                const result = this._getSvg(hash);
                if (result?.svg) {
                    // Wrap SVG in a div so Marp treats it as HTML content
                    return `<div class="tikz-thumb">${result.svg}</div>`;
                }
                return '<div class="tikz-thumb" style="text-align:center;color:#888;padding:1em;">TikZ diagram</div>';
            }
        );

        try {
            const { Marp } = require('@marp-team/marp-core');
            const marp = new Marp({ html: true });
            const { html, css } = marp.render(processed);

            // Split into per-slide SVGs — Marp wraps each slide in <svg>...</svg>
            const svgRegex = /<svg data-marpit-svg=""[^>]*>[\s\S]*?<\/svg>/g;
            const slides: string[] = [];
            let match;
            while ((match = svgRegex.exec(html)) !== null) {
                slides.push(match[0]);
            }

            return { slidesHtml: slides, css };
        } catch {
            return { slidesHtml: [], css: '' };
        }
    }

    private _getHtml(marpHtml: { slidesHtml: string[]; css: string }, slideLines: number[]): string {
        const thumbnails = marpHtml.slidesHtml.map((slideHtml, i) => {
            const line = slideLines[i] ?? 0;
            const num = i + 1;
            return `<div class="thumb" onclick="goToSlide(${line})" title="Slide ${num}">
                <div class="thumb-slide-wrapper">
                    <div class="thumb-num">${num}</div>
                    <div class="thumb-slide-content marpit">${slideHtml}</div>
                </div>
            </div>`;
        }).join('');

        return `<!DOCTYPE html>
<html>
<head>
<style>
    /* Marp's own styles */
    ${marpHtml.css}

    /* Thumbnail layout styles */
    body {
        margin: 0;
        padding: 8px;
        font-family: var(--vscode-font-family);
        background: var(--vscode-sideBar-background);
    }
    .thumb {
        cursor: pointer;
        margin-bottom: 8px;
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid var(--vscode-panel-border, #333);
        transition: border-color 0.15s;
    }
    .thumb:hover {
        border-color: var(--vscode-focusBorder);
    }
    .thumb-slide-wrapper {
        position: relative;
        width: 100%;
        aspect-ratio: 16/9;
        overflow: hidden;
    }
    .thumb-num {
        position: absolute;
        top: 4px;
        right: 6px;
        font-size: 10px;
        font-weight: bold;
        opacity: 0.6;
        z-index: 10;
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        border-radius: 3px;
        padding: 0 4px;
    }
    .thumb-slide-content {
        width: 100%;
        height: 100%;
    }
    /* Scale the Marp SVG to fit the thumbnail container */
    .thumb-slide-content > svg {
        width: 100% !important;
        height: 100% !important;
    }
    /* Scale down TikZ SVGs inside thumbnails */
    .tikz-thumb svg {
        max-width: 100%;
        max-height: 100%;
    }
</style>
</head>
<body>
    ${thumbnails || '<p style="color:#888;padding:12px;">No slides found.</p>'}
    <script>
        const vscode = acquireVsCodeApi();
        function goToSlide(line) {
            vscode.postMessage({ type: 'goToSlide', line: line });
        }
    </script>
</body>
</html>`;
    }
}
