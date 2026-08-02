# IC Floorplanner

IC Floorplanner is a browser-based ASIC floorplanning tool with a CAD-style canvas and direct Cadence Virtuoso SKILL export. Define reusable IP masters, place and transform instances, measure spacing, align groups, save editable projects, and export review-ready SVGs without sending project data to a server.

![IC Floorplanner overview](src/assets/hero.png)

## Highlights

- Center-origin top-cell canvas with positive Y upward, matching the generated layout coordinates.
- Grid-snapped placement with top-cell boundary enforcement.
- All eight Cadence orientations: `R0`, `R90`, `R180`, `R270`, `MX`, `MY`, `MXR90`, and `MYR90`.
- Mouse rotation handle with 90-degree snapping and center-preserving rotation.
- Shift-click multi-selection with transformed-edge alignment and equal-gap distribution.
- Full project Undo and Redo, including placement, transforms, rulers, master edits, alignment, and top-cell changes.
- Manual rulers, orthogonal measurement, edge snapping, selected-IP gaps, and reduced-clutter Auto-Dim.
- Versioned `.flp` project save/open with validation and unsaved-change protection.
- SVG export with an embedded project payload for lossless re-import.
- Cadence SKILL preview and export with real OpenAccess `prBoundary` objects.

## Quick start

Requirements: a current Node.js installation and npm.

```bash
git clone https://github.com/YongkaiZHANG/Floorplanner.git
cd Floorplanner
npm install
npm run dev
```

Vite prints the local development URL. For a production check:

```bash
npm test
npm run lint
npm run build
```

## Typical workflow

### 1. Configure the design

Use the Top Cell settings to define the destination library, cell name, width, and height. The top-cell origin is at its physical center.

Create Master IP definitions in the left sidebar. Each master has:

- A Cadence library and cell name
- Width and height in micrometers
- A canvas color selected from the extended palette or custom color picker

Master geometry uses `(0, 0)` as its local origin, which is also the instance origin exported to Virtuoso.

### 2. Place and edit instances

Click the crosshair beside a master or press `i` to attach an instance to the cursor. Placement remains active for repeated placement until cancelled.

Select a block to edit exact X/Y coordinates and orientation in the Properties panel. Rotation is available in three ways:

- Drag the blue rotation handle above the selected block
- Use the ±90° buttons in Properties
- Press `r` or `Shift+r`

Mouse rotation snaps to legal Cadence quarter turns and keeps the block's physical center stable. Mirrored instances stay in the mirrored orientation family.

### 3. Select and arrange blocks

Shift-click blocks on the canvas or in the instance list to build a multi-selection. The Align menu supports:

- Left, right, top, and bottom physical edges
- Horizontal and vertical physical centers
- Horizontal or vertical equal-gap distribution for three or more blocks

Alignment is calculated from the displayed transformed bounds, so rotated and mirrored blocks align correctly. A complete alignment operation creates one Undo entry.

### 4. Measure and inspect spacing

Ruler mode supports grid and object-edge snapping. Press `o` for orthogonal measurement or double-click a block to create width and height rulers.

Selecting a block shows its directly visible neighboring gaps in blue. Auto-Dim shows only the nearest visible neighbor in each direction instead of every possible pair. Violet labels name both endpoint instances, and hovering a dimension fades the others so the relationship is easy to trace.

### 5. Save or export

- **Save** downloads a validated, versioned `.flp` project.
- **Open Project** accepts `.flp`, legacy JSON, or an SVG exported by this application.
- **Export SVG** creates a presentation-ready vector drawing and embeds editable project metadata.
- **Preview Code** displays the generated Cadence SKILL before download.

The Saved/Unsaved indicator tracks the last explicit project save or open. The application warns before replacing unsaved work or closing the page.

## Cadence Virtuoso export

Before exporting, ensure every referenced library already exists in `cds.lib` and is attached to the intended technology library.

1. Open **Preview Code** and inspect the destination libraries and cell names.
2. Download the `.il` file.
3. In the Virtuoso CIW, run:

```skill
load("/absolute/path/to/top_cell.il")
```

Loading the file calls `FPCreateFloorplan()` automatically. It creates or overwrites the generated `layout` cellviews using `maskLayout`, creates real `prBoundary` objects, opens masters read-only, and places instances with the same coordinates and orientations shown on the canvas.

> **Important:** the generated script uses write mode and can overwrite existing layout views with matching library/cell names. Review the preview before loading it.

Geometry, hierarchy, coordinates, and orientation are portable. Canvas colors are visual planning aids; Virtuoso display colors come from the destination technology and display resource configuration.

## Keyboard and mouse controls

| Input | Action |
| --- | --- |
| Mouse wheel | Zoom around the pointer |
| Middle-drag | Pan the canvas |
| Shift-click | Add or remove a block from the selection |
| `n` | Create a Master IP |
| `i` | Instantiate an IP |
| `c` | Copy the selected instance into placement mode |
| `r` / `Shift+r` | Rotate the primary selection ±90° |
| `q` | Toggle the Properties panel for the selection |
| `m` | Return to Select mode |
| `k` | Enter Ruler mode |
| `Shift+k` | Clear all rulers |
| `o` | Toggle orthogonal ruler measurement |
| `f` | Fit the top cell to the viewport |
| `u` | Undo |
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Shift+Z` | Redo |
| `Ctrl+Y` | Redo |
| `Ctrl/Cmd+S` | Save a `.flp` project |
| `Ctrl/Cmd+A` | Select all instances |
| `Delete` / `Backspace` | Delete the selection |
| `Escape` | Cancel placement/measurement or clear selection |

## Project structure

```text
src/
  canvas/       Konva canvas, transforms, rulers, dimensions, rotation UI
  components/   Toolbars, sidebars, properties, tutorial, notifications
  store/        Zustand project state, history, and project documents
  utils/        Alignment, SVG export, and Cadence SKILL generation
tests/          Geometry, persistence, history, store, and SKILL tests
```

The application is built with React 19, TypeScript, Vite, Zustand, Konva, and React Icons.

## License

MIT
