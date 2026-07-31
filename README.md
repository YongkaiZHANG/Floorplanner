# IC Floorplanner 🚀

A modern, web-based EDA tool for ASIC floorplanning. Draw, organize, and measure your IC floorplan in an intuitive interface that feels like native CAD software, and seamlessly export your work to Cadence SKILL code (`.il`) or high-quality vector graphics (SVG).

![Floorplanner Overview](src/assets/hero.png) *(Preview of the sleek, dark-themed UI)*

## 🌟 Key Features

*   **Native CAD Experience:** Middle-mouse panning, scroll-wheel zooming, and an extensive suite of keyboard shortcuts designed for power users.
*   **Precision Grid System:** Strict grid snapping (`0.001um` default precision) ensures zero off-grid violations.
*   **Smart Z-Index & Occlusion Management:** Small IPs automatically float above larger ones based on area, making nested selection and dragging effortless.
*   **Advanced Measurement Tool:** Interactive rulers with orthogonal modes, snapping, and precision distance calculations.
*   **Live SKILL Code Preview:** Instantly view and copy the Cadence SKILL code generated from your placement.
*   **Lossless SVG Export:** Export your entire floorplan (including precise ruler measurements and accurate scales) to standard SVG for design reviews or embedding in presentations.
*   **Save/Load Projects:** Import and export your workspace as a `.flp` JSON file.

## ⌨️ Keyboard Shortcuts (Native CAD UX)

Master these shortcuts to dramatically speed up your floorplanning workflow:

| Key | Action |
| :--- | :--- |
| <kbd>n</kbd> | Create new Master IP (Template) |
| <kbd>i</kbd> | Instantiate an IP (Attach to cursor) |
| <kbd>c</kbd> | Copy selected instance |
| <kbd>q</kbd> | Toggle Properties Panel for selected IP |
| <kbd>m</kbd> | Select Mode (Cancel placement) |
| <kbd>k</kbd> | Ruler Tool (Measure distance) |
| <kbd>Shift</kbd> + <kbd>k</kbd> | Clear all rulers |
| <kbd>o</kbd> | Toggle Orthogonal measuring (when Ruler is active) |
| <kbd>f</kbd> | Fit view to screen (Zoom to fit) |
| <kbd>u</kbd> | Undo last action |
| <kbd>Del</kbd> / <kbd>Backspace</kbd> | Delete selected instance |
| <kbd>Esc</kbd> | Cancel current action |
| <kbd>Space</kbd> + <kbd>Left Click</kbd> | Pan (Move Canvas) |
| <kbd>Middle Mouse Button</kbd> | Pan (Move Canvas) |

## 🛠️ Technology Stack

*   **Frontend Framework:** React 18 (with TypeScript)
*   **Build Tool:** Vite for lightning-fast HMR and building
*   **Canvas Engine:** Konva.js (`react-konva`) for high-performance 2D WebGL/Canvas rendering
*   **State Management:** Zustand for lightweight, immutable state logic
*   **Icons:** React Icons (`fi` / Feather Icons)

## 🚀 Getting Started

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/YongkaiZHANG/Floorplanner.git
    cd Floorplanner
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run the development server:**
    ```bash
    npm run dev
    ```

4.  **Build for production:**
    ```bash
    npm run build
    ```

## 📐 Exporting to Cadence (SKILL)

1.  Click **Preview Code** to inspect the generated code.
2.  Click **Export SKILL** to download the `floorplan.il` script.
3.  In your Cadence Virtuoso CIW window, run:
    ```skill
    load("path/to/floorplan.il")
    createFloorplan("YourLibraryName" "YourTopCellName")
    ```

## 📄 License

MIT License
