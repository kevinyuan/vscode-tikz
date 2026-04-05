---
marp: true
---

# Test: %!include in Marp

---

## Inline TikZ

```tikz
\begin{tikzpicture}
\draw[green,thick] (0,0) rectangle (2,1);
\node at (1,0.5) {Inline};
\end{tikzpicture}
```

---

## Included: Arrow Diagram

```tikz
%!include diagrams/simple-arrow.tikz
```

---

## Included: Circle Diagram

```tikz
%!include diagrams/circle.tikz
```

---

## Missing file (error)

```tikz
%!include diagrams/nonexistent.tikz
```
