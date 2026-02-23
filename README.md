# TikZJax for VS Code

Render beautiful LaTeX and TikZ diagrams directly in your Markdown files. Create mathematical diagrams, circuit schematics, chemical structures, commutative diagrams, and more—all with live preview.

![TikZJax Extension Screenshot](imgs/screenshot.png)

## Features

- **Live Preview**: See your TikZ diagrams rendered in real-time as you type
- **Rich Package Support**: Use chemfig, circuitikz, pgfplots, tikz-cd, and more
- **Dark Mode**: Automatic color inversion for seamless dark theme integration
- **Smart Caching**: Previously rendered diagrams load instantly
- **Error Handling**: Clear error messages with retry options
- **Syntax Highlighting**: LaTeX syntax highlighting in tikz code blocks

## Quick Start

1. Create or open a Markdown file in VS Code
2. Add a tikz code block:

````markdown
```tikz
\begin{document}
\begin{tikzpicture}
  \draw[thick, ->] (0,0) -- (2,0) node[right] {$x$};
  \draw[thick, ->] (0,0) -- (0,2) node[above] {$y$};
  \draw[blue, thick] (0,0) circle (1);
\end{tikzpicture}
\end{document}
```
````

3. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
4. Run **TikZJax: Open TikZ Preview**
5. Your diagram appears in the preview panel!

## Usage

### Basic TikZ Diagram

Create geometric shapes and drawings:

````markdown
```tikz
\begin{document}
\begin{tikzpicture}
  % Rectangle
  \draw[thick] (0,0) rectangle (2,1.5);
  
  % Circle
  \draw[fill=blue!20] (4,0.75) circle (0.75);
  
  % Triangle
  \draw[fill=red!20] (6,0) -- (7.5,0) -- (6.75,1.5) -- cycle;
\end{tikzpicture}
\end{document}
```
````

### Graph with Nodes

````markdown
```tikz
\begin{document}
\begin{tikzpicture}[node distance=2cm]
  \node[circle,draw] (A) {A};
  \node[circle,draw] (B) [right of=A] {B};
  \node[circle,draw] (C) [below of=A] {C};
  \node[circle,draw] (D) [right of=C] {D};
  
  \draw[->] (A) -- (B);
  \draw[->] (A) -- (C);
  \draw[->] (B) -- (D);
  \draw[->] (C) -- (D);
\end{tikzpicture}
\end{document}
```
````

## Supported Packages

The extension supports a wide range of LaTeX packages for specialized diagrams:

### Chemistry - chemfig

Draw chemical structures and molecules:

````markdown
```tikz
\usepackage{chemfig}
\begin{document}
\chemfig{H_3C-CH_2-OH}
\end{document}
```
````

### Circuits - circuitikz

Create electronic circuit diagrams:

````markdown
```tikz
\usepackage{circuitikz}
\begin{document}
\begin{circuitikz}
  \draw (0,0) to[battery1, l=$V$] (0,3)
        to[R=$R_1$] (3,3)
        to[R=$R_2$] (3,0)
        -- (0,0);
\end{circuitikz}
\end{document}
```
````

### Plots - pgfplots

Plot mathematical functions and data:

````markdown
```tikz
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\begin{document}
\begin{tikzpicture}
  \begin{axis}[
    xlabel=$x$,
    ylabel=$y$,
    domain=-2:2,
    samples=100
  ]
    \addplot[blue, thick] {x^2};
    \addplot[red, thick] {x^3};
  \end{axis}
\end{tikzpicture}
\end{document}
```
````

### Commutative Diagrams - tikz-cd

Create category theory diagrams:

````markdown
```tikz
\usepackage{tikz-cd}
\begin{document}
\begin{tikzcd}
  A \arrow[r, "f"] \arrow[d, "g"] & B \arrow[d, "h"] \\
  C \arrow[r, "k"] & D
\end{tikzcd}
\end{document}
```
````

### 3D Diagrams - tikz-3dplot

Draw three-dimensional figures:

````markdown
```tikz
\usepackage{tikz-3dplot}
\begin{document}
\tdplotsetmaincoords{60}{110}
\begin{tikzpicture}[tdplot_main_coords]
  \draw[thick,->] (0,0,0) -- (3,0,0) node[anchor=north east]{$x$};
  \draw[thick,->] (0,0,0) -- (0,3,0) node[anchor=north west]{$y$};
  \draw[thick,->] (0,0,0) -- (0,0,3) node[anchor=south]{$z$};
\end{tikzpicture}
\end{document}
```
````

### Mathematics - amsmath, amstext, amsfonts, amssymb

Full support for advanced mathematical notation and symbols.

### Arrays - array

Create complex array and table structures within diagrams.

## Commands

Access these commands via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---------|-------------|
| **TikZJax: Open TikZ Preview** | Open the preview panel to see rendered diagrams |
| **TikZJax: Refresh TikZ Diagrams** | Re-render all diagrams in the current document |
| **TikZJax: Clear TikZ Cache** | Clear cached diagrams and force fresh rendering |
| **TikZJax: Reset TikZJax Engine** | Reset the rendering engine (useful after errors) |

All commands are available when editing Markdown files.

## Configuration

Customize the extension behavior through VS Code settings:

### `tikzjax.invertColorsInDarkMode`

**Type:** `boolean`  
**Default:** `true`

Automatically invert diagram colors when using a dark theme. Black colors become the current text color, and white colors match the background.

```json
{
  "tikzjax.invertColorsInDarkMode": true
}
```

### `tikzjax.renderTimeout`

**Type:** `number` (milliseconds)  
**Default:** `15000`  
**Range:** 1000 - 60000

Maximum time to wait for a diagram to render before timing out. Increase this for complex diagrams.

```json
{
  "tikzjax.renderTimeout": 20000
}
```

### `tikzjax.autoPreview`

**Type:** `boolean`  
**Default:** `false`

Automatically open the preview panel when opening a Markdown file containing TikZ diagrams.

```json
{
  "tikzjax.autoPreview": true
}
```

### `tikzjax.previewPosition`

**Type:** `"side" | "below" | "window"`  
**Default:** `"side"`

Default position for the preview panel:
- `"side"`: Open beside the editor (recommended)
- `"below"`: Open below the editor
- `"window"`: Open in a separate window

```json
{
  "tikzjax.previewPosition": "side"
}
```

## Tips and Tricks

### Multiple Diagrams

You can include multiple tikz code blocks in a single Markdown file. Each diagram renders independently:

````markdown
# My Document

First diagram:

```tikz
\begin{document}
\begin{tikzpicture}
  \draw (0,0) circle (1);
\end{tikzpicture}
\end{document}
```

Second diagram:

```tikz
\begin{document}
\begin{tikzpicture}
  \draw (0,0) rectangle (2,1);
\end{tikzpicture}
\end{document}
```
````

### Error Handling

If a diagram fails to render, the extension displays an error message inline. Common issues:

- **Syntax errors**: Check your LaTeX syntax
- **Missing packages**: Ensure you've included the correct `\usepackage{}` statement
- **Timeout**: Increase `tikzjax.renderTimeout` for complex diagrams

Use the **Retry** button or **Reset TikZJax Engine** command to recover from errors.

### Performance

- **Caching**: Rendered diagrams are cached automatically. Unchanged diagrams load instantly.
- **Incremental Updates**: Only modified diagrams are re-rendered when you edit.
- **Clear Cache**: Use the **Clear TikZ Cache** command if you need to force re-rendering.

### Dark Mode

The extension automatically adjusts diagram colors for dark themes. If you prefer original colors, disable this feature:

```json
{
  "tikzjax.invertColorsInDarkMode": false
}
```

## Examples

Check out the [examples/tikz-examples.md](examples/tikz-examples.md) file for a comprehensive collection of diagrams demonstrating all supported packages and features.

## Troubleshooting

### Diagrams not rendering

1. Ensure you're editing a Markdown file (`.md` extension)
2. Check that your code block uses the `tikz` language identifier
3. Open the preview panel with **TikZJax: Open TikZ Preview**
4. Check the error message if displayed

### Slow rendering

1. Increase the timeout: `"tikzjax.renderTimeout": 30000`
2. Simplify complex diagrams
3. Use the cache—unchanged diagrams load instantly

### Preview not updating

1. Use **TikZJax: Refresh TikZ Diagrams** to force an update
2. Try **TikZJax: Reset TikZJax Engine** if issues persist
3. Close and reopen the preview panel

### Colors look wrong in dark mode

1. Toggle `tikzjax.invertColorsInDarkMode` setting
2. Use explicit colors in your diagrams if needed
3. Refresh the preview after changing themes

## Requirements

- VS Code version 1.85.0 or higher
- Active internet connection for initial TikZJax library loading

## License

MIT License - see [LICENSE.md](LICENSE.md) for details.

## Acknowledgments

This extension was inspired by and builds upon the excellent work of:

- **[node-tikzjax](https://github.com/drgrice1/node-tikzjax)** by @drgrice1 - Server-side TikZ rendering engine that powers this extension
- **[obsidian-tikzjax](https://github.com/artisticat1/obsidian-tikzjax)** by @artisticat1 - Original Obsidian plugin that demonstrated TikZ integration in note-taking apps
- **[TikZJax](https://github.com/kisonecat/tikzjax)** by @kisonecat - The foundational browser-based TikZ compiler

Special thanks to these projects for making LaTeX and TikZ accessible in modern editing environments.

---

**Enjoy creating beautiful diagrams!** If you encounter issues or have suggestions, please [file an issue on GitHub](https://github.com/kevinyuan/vscode-tikz/issues).
