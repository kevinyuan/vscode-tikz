# TikZ Examples for VS Code TikZJax Extension

This document demonstrates the various TikZ packages and features supported by the extension.

---

## 1. Geometric Shapes

```tikz
\begin{document}
\begin{tikzpicture}
  \draw[thick] (0,0) rectangle (2,1.5);
  \draw[fill=blue!20] (4,0.75) circle (0.75);
  \draw[fill=red!20] (6,0) -- (7.5,0) -- (6.75,1.5) -- cycle;
\end{tikzpicture}
\end{document}
```

## 2. Graph with Nodes and Edges

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

## 3. Ethanol Molecule (chemfig)

```tikz
\usepackage{chemfig}
\begin{document}
\chemfig{H_3C-CH_2-OH}
\end{document}
```

## 4. Benzene Ring (chemfig)

```tikz
\usepackage{chemfig}
\begin{document}
\chemfig{*6(=-=-=-)}
\end{document}
```

## 5. Glucose Molecule (chemfig)

```tikz
\usepackage{chemfig}
\begin{document}
\chemfig{
  HO-[2,0.5,2]?<[7,0.7](-[2,0.5]OH)-[,,,,line width=2.4pt]
  (-[6,0.5]OH)>[1,0.7](-[6,0.5]OH)-[3,0.7]O-[4]?(-[2,0.3]-[3,0.5]OH)
}
\end{document}
```

## 6. Basic Resistor Circuit (circuitikz)

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

## 7. RC Circuit (circuitikz)

```tikz
\usepackage{circuitikz}
\begin{document}
\begin{circuitikz}
  \draw (0,0) to[V=$V_s$] (0,3)
        to[R=$R$] (3,3)
        to[C=$C$] (3,0)
        -- (0,0);
  \draw (3,3) to[short, -o] (4,3);
  \draw (3,0) to[short, -o] (4,0);
  \node at (4.5,1.5) {$V_{out}$};
\end{circuitikz}
\end{document}
```

## 8. Voltage Divider (circuitikz)

```tikz
\usepackage{circuitikz}
\begin{document}
\begin{circuitikz}
  \draw (0,0) to[V=$V_s$] (0,3)
        to[R=$R_1$] (3,3)
        to[R=$R_2$] (3,0)
        -- (0,0);
  \draw (3,3) to[short, -o] (4,3);
  \draw (3,0) to[short, -o] (4,0);
  \node at (4.5,1.5) {$V_{out}$};
\end{circuitikz}
\end{document}
```

## 9. Function Plot (pgfplots)

```tikz
\usepackage{pgfplots}
\pgfplotsset{compat=1.16}
\begin{document}
\begin{tikzpicture}
  \begin{axis}[xlabel=$x$, ylabel=$y$, domain=-2:2, samples=100]
    \addplot[blue, thick] {x^2};
    \addplot[red, thick] {x^3};
  \end{axis}
\end{tikzpicture}
\end{document}
```

## 10. Trigonometric Functions (pgfplots)

```tikz
\usepackage{pgfplots}
\pgfplotsset{compat=1.16}
\begin{document}
\begin{tikzpicture}
  \begin{axis}[xlabel=$x$, ylabel=$y$, domain=0:360, samples=100, legend pos=north east]
    \addplot[blue] {sin(x)};
    \addplot[red] {cos(x)};
    \legend{$\sin(x)$, $\cos(x)$}
  \end{axis}
\end{tikzpicture}
\end{document}
```

## 11. Bar Chart (pgfplots)

```tikz
\usepackage{pgfplots}
\pgfplotsset{compat=1.16}
\begin{document}
\begin{tikzpicture}
  \begin{axis}[ybar, symbolic x coords={A,B,C,D,E}, xtick=data, ylabel=Values]
    \addplot coordinates {(A,20) (B,35) (C,15) (D,40) (E,25)};
  \end{axis}
\end{tikzpicture}
\end{document}
```

## 12. Commutative Square (tikz-cd)

```tikz
\usepackage{tikz-cd}
\begin{document}
\begin{tikzcd}
  A \arrow[r, "f"] \arrow[d, "g"] & B \arrow[d, "h"] \\
  C \arrow[r, "k"] & D
\end{tikzcd}
\end{document}
```

## 13. Exact Sequence (tikz-cd)

```tikz
\usepackage{tikz-cd}
\begin{document}
\begin{tikzcd}
  0 \arrow[r] & A \arrow[r, "\alpha"] & B \arrow[r, "\beta"] & C \arrow[r] & 0
\end{tikzcd}
\end{document}
```

## 14. Pullback Diagram (tikz-cd)

```tikz
\usepackage{tikz-cd}
\usepackage{amssymb}
\begin{document}
\begin{tikzcd}
  A \arrow[r] \arrow[d] \arrow[dr, phantom, "\ulcorner", very near start] & B \arrow[d] \\
  C \arrow[r] & D
\end{tikzcd}
\end{document}
```

## 15. Matrix (amsmath)

```tikz
\usepackage{amsmath}
\begin{document}
\begin{tikzpicture}
  \node at (0,0) {$\begin{bmatrix}
    a_{11} & a_{12} & a_{13} \\
    a_{21} & a_{22} & a_{23} \\
    a_{31} & a_{32} & a_{33}
  \end{bmatrix}$};
\end{tikzpicture}
\end{document}
```

## 16. Annotated Equation (amsmath + positioning)

```tikz
\usepackage{amsmath}
\usetikzlibrary{positioning}
\begin{document}
\begin{tikzpicture}
  \node (eq) at (0,0) {$E = mc^2$};
  \node[above=0.5cm of eq] {Einstein's Mass-Energy Equivalence};
  \draw[->, thick] (eq.south) -- ++(0,-0.5) node[below] {Energy};
\end{tikzpicture}
\end{document}
```

## 17. 3D Coordinate System (tikz-3dplot)

```tikz
\usepackage{tikz-3dplot}
\begin{document}
\tdplotsetmaincoords{60}{110}
\begin{tikzpicture}[tdplot_main_coords]
  \draw[thick,->] (0,0,0) -- (3,0,0) node[anchor=north east]{$x$};
  \draw[thick,->] (0,0,0) -- (0,3,0) node[anchor=north west]{$y$};
  \draw[thick,->] (0,0,0) -- (0,0,3) node[anchor=south]{$z$};
  \draw[thick] (0,0,0) -- (2,0,0) -- (2,2,0) -- (0,2,0) -- cycle;
  \draw[thick] (0,0,2) -- (2,0,2) -- (2,2,2) -- (0,2,2) -- cycle;
  \draw[thick] (0,0,0) -- (0,0,2);
  \draw[thick] (2,0,0) -- (2,0,2);
  \draw[thick] (2,2,0) -- (2,2,2);
  \draw[thick] (0,2,0) -- (0,2,2);
\end{tikzpicture}
\end{document}
```

## 18. Styled Pipeline

```tikz
\begin{document}
\begin{tikzpicture}[
  box/.style={rectangle, draw, fill=blue!20, minimum width=2cm, minimum height=1cm},
  arrow/.style={->, thick, >=stealth}
]
  \node[box] (start) at (0,0) {Start};
  \node[box] (process) at (4,0) {Process};
  \node[box] (end) at (8,0) {End};
  \draw[arrow] (start) -- (process);
  \draw[arrow] (process) -- (end);
\end{tikzpicture}
\end{document}
```

## 19. Tree Diagram

```tikz
\begin{document}
\begin{tikzpicture}[
  level 1/.style={sibling distance=3cm},
  level 2/.style={sibling distance=1.5cm}
]
  \node {Root}
    child {node {A}
      child {node {A1}}
      child {node {A2}}
    }
    child {node {B}
      child {node {B1}}
      child {node {B2}}
    };
\end{tikzpicture}
\end{document}
```

## 20. Flowchart

```tikz
\usetikzlibrary{shapes.geometric}
\begin{document}
\begin{tikzpicture}[
  node distance=1.5cm,
  decision/.style={diamond, draw, fill=yellow!20, text width=4em, text centered},
  process/.style={rectangle, draw, fill=blue!20, text width=5em, text centered, minimum height=2em},
  io/.style={trapezium, draw, fill=green!20, text width=4em, text centered, trapezium left angle=70, trapezium right angle=110}
]
  \node[io] (input) {Input};
  \node[process] (proc1) [below of=input] {Process};
  \node[decision] (dec1) [below of=proc1] {Decision};
  \node[process] (proc2) [below of=dec1, yshift=-0.5cm] {Action A};
  \node[process] (proc3) [right of=proc2, xshift=2cm] {Action B};
  \node[io] (output) [below of=proc2, yshift=-0.5cm] {Output};
  \draw[->] (input) -- (proc1);
  \draw[->] (proc1) -- (dec1);
  \draw[->] (dec1) -- node[left] {Yes} (proc2);
  \draw[->] (dec1) -- node[above] {No} (proc3);
  \draw[->] (proc2) -- (output);
  \draw[->] (proc3) |- (output);
\end{tikzpicture}
\end{document}
```

## 21. Gradient and Shading

```tikz
\begin{document}
\begin{tikzpicture}
  \shade[left color=red, right color=blue] (0,0) rectangle (3,2);
  \shade[inner color=yellow, outer color=orange] (5,1) circle (1);
  \draw[fill=green!30, draw=green!50!black, thick] (8,0) -- (9.5,0) -- (9,2) -- cycle;
\end{tikzpicture}
\end{document}
```

## 22. Dark Mode Test

```tikz
\begin{document}
\begin{tikzpicture}
  \draw[fill=black] (0,0) rectangle (2,1);
  \node at (1,0.5) [white] {Black Box};
  \draw[fill=white, draw=black] (3,0) rectangle (5,1);
  \node at (4,0.5) {White Box};
  \draw[fill=blue!50] (6,0) rectangle (8,1);
  \node at (7,0.5) [white] {Blue Box};
\end{tikzpicture}
\end{document}
```
