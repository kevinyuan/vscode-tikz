---
marp: true
---

# TikZ in Marp Slides

Testing TikZ rendering inside Marp slide decks.

---

## Simple Shape

Here is a rectangle with a label, rendered via TikZ:

```tikz
\begin{document}
\begin{tikzpicture}[scale=2]
  \draw[thick] (0,0) rectangle (3,2);
  \node at (1.5,1) {\Large Hello Marp!};
\end{tikzpicture}
\end{document}
```

The diagram above should appear inline with this text content.

---

## Mixed Content: Text + Diagram

Some bullet points alongside a diagram:

- TikZ diagrams render as SVG
- They should scale to fit the slide
- Text before and after should look normal

```tikz
\begin{document}
\begin{tikzpicture}[scale=2]
  \node[circle, draw, thick, minimum size=2cm, font=\Large] (a) at (0,0) {A};
  \node[circle, draw, thick, minimum size=2cm, font=\Large] (b) at (5,0) {B};
  \draw[->, very thick] (a) -- (b) node[midway, above, font=\large] {edge};
\end{tikzpicture}
\end{document}
```

This paragraph comes after the diagram. The layout should flow naturally.

---

## Graph with Surrounding Context

Below is a simple graph structure:

```tikz
\begin{document}
\begin{tikzpicture}[scale=2, node distance=2.5cm, every node/.style={circle, draw, thick, minimum size=1.2cm, font=\Large}]
  \node (1) {1};
  \node (2) [right of=1] {2};
  \node (3) [below of=1] {3};
  \node (4) [right of=3] {4};
  \draw[thick] (1) -- (2);
  \draw[thick] (1) -- (3);
  \draw[thick] (2) -- (4);
  \draw[thick] (3) -- (4);
\end{tikzpicture}
\end{document}
```

**Key observations:** 4 nodes, 4 edges, forming a cycle.
