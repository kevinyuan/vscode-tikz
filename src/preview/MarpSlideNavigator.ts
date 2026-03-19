import * as vscode from 'vscode';

interface SlideInfo {
    index: number;
    heading: string;
    cssClass: string;
    line: number;
}

class SlideItem extends vscode.TreeItem {
    constructor(public readonly slide: SlideInfo) {
        const label = `${slide.index}. ${slide.heading}`;
        super(label, vscode.TreeItemCollapsibleState.None);

        this.description = slide.cssClass || undefined;
        this.tooltip = `Slide ${slide.index}: ${slide.heading}`;
        this.command = {
            command: 'tikzjax.goToSlide',
            title: 'Go to Slide',
            arguments: [slide.line]
        };

        // Use different icons for different slide types
        if (slide.cssClass === 'title') {
            this.iconPath = new vscode.ThemeIcon('home');
        } else if (slide.cssClass === 'section-divider') {
            this.iconPath = new vscode.ThemeIcon('symbol-namespace');
        } else if (slide.cssClass === 'thankyou') {
            this.iconPath = new vscode.ThemeIcon('heart');
        } else {
            this.iconPath = new vscode.ThemeIcon('file');
        }
    }
}

export class MarpSlideNavigator implements vscode.TreeDataProvider<SlideItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _slides: SlideInfo[] = [];

    refresh(document?: vscode.TextDocument): void {
        const doc = document || this._getActiveMarkdownDocument();
        if (doc) {
            this._slides = this._parseSlides(doc);
        } else {
            this._slides = [];
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SlideItem): vscode.TreeItem {
        return element;
    }

    getChildren(): SlideItem[] {
        return this._slides.map(s => new SlideItem(s));
    }

    private _getActiveMarkdownDocument(): vscode.TextDocument | undefined {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'markdown') {
            return editor.document;
        }
        // Check all visible editors
        for (const e of vscode.window.visibleTextEditors) {
            if (e.document.languageId === 'markdown') {
                return e.document;
            }
        }
        return undefined;
    }

    private _parseSlides(document: vscode.TextDocument): SlideInfo[] {
        const text = document.getText();
        const lines = text.split('\n');
        const slides: SlideInfo[] = [];

        // Check if it's a Marp file
        if (!text.match(/^---\s*\n[\s\S]*?marp:\s*true/m)) {
            return [];
        }

        // Find the end of frontmatter
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

        let slideIndex = 1;
        let currentSlideStart = frontmatterEnd;
        let currentClass = '';
        let currentHeading = '';

        for (let i = frontmatterEnd + 1; i < lines.length; i++) {
            const line = lines[i];

            // Detect slide separator
            if (line.trim() === '---') {
                // Save previous slide
                if (slideIndex > 0) {
                    slides.push({
                        index: slideIndex,
                        heading: currentHeading || `Slide ${slideIndex}`,
                        cssClass: currentClass,
                        line: currentSlideStart,
                    });
                }
                slideIndex++;
                currentSlideStart = i;
                currentClass = '';
                currentHeading = '';
                continue;
            }

            // Detect class directive
            const classMatch = line.match(/<!--\s*_class:\s*([^\s-]+)/);
            if (classMatch && !currentClass) {
                currentClass = classMatch[1];
            }

            // Detect first heading
            const headingMatch = line.match(/^#+\s+(.+)/);
            if (headingMatch && !currentHeading) {
                currentHeading = headingMatch[1].trim();
            }
        }

        // Save last slide
        if (slideIndex > 0) {
            slides.push({
                index: slideIndex,
                heading: currentHeading || `Slide ${slideIndex}`,
                cssClass: currentClass,
                line: currentSlideStart,
            });
        }

        return slides;
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}
