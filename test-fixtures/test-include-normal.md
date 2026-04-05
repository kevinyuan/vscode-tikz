# Test: %!include in Normal Markdown

## Inline TikZ block (should still work)

```tikz
\begin{tikzpicture}
\draw[green,thick] (0,0) rectangle (2,1);
\node at (1,0.5) {Inline};
\end{tikzpicture}
```

## Included TikZ block (arrow diagram)

```tikz
%!include diagrams/simple-arrow.tikz
```

## Included TikZ block (circle diagram)

```tikz
%!include diagrams/circle.tikz
```

## Missing file (should show error)

```tikz
%!include diagrams/nonexistent.tikz
```
