# IC Floorplanner

IC Floorplanner is a browser-based ASIC floorplanning tool with a CAD-style canvas and direct Cadence Virtuoso SKILL export. Define reusable IP masters, place and transform instances, measure spacing, align groups, save editable projects, and export review-ready SVGs without sending project data to a server.

![IC Floorplanner overview](src/assets/hero.png)

## Highlights

- Center-origin top-cell canvas with positive Y upward, matching the generated layout coordinates.
- Grid-snapped placement with top-cell boundary enforcement.
- All eight Cadence orientations: `R0`, `R90`, `R180`, `R270`, `MX`, `MY`, `MXR90`, and `MYR90`.
- Mouse right-click rotation with 90-degree snapping, plus keyboard and Properties controls.
- Cadence-style side placement with an exact, remembered face-to-face spacing.
- Shift-click multi-selection with quick transformed-edge alignment and equal-gap distribution.
- Full project Undo and Redo, including placement, transforms, rulers, master edits, alignment, and top-cell changes.
- Manual rulers, orthogonal measurement, edge snapping, selected-IP gaps, and reduced-clutter Auto-Dim.
- Browser-viewable SVG save with an embedded project payload for lossless re-import.
- Versioned `.flp` backup/open with validation and unsaved-change protection.
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

- Right-click an IP to rotate clockwise; Shift-right-click rotates counterclockwise
- Use the ±90° buttons in Properties
- Press `r` or `Shift+r`

Mouse rotation snaps to legal Cadence quarter turns and keeps the block's physical center stable. Mirrored instances stay in the mirrored orientation family.

### 3. Select and arrange blocks

For Cadence-style alignment, first select the IP that should move. Click **Align** (or press `a`); the compact alignment controls replace the right side of the top toolbar so no window covers the canvas. Click an amber source edge to choose the alignment axis, then click a compatible green reference: another IP side, a top-cell boundary, or an orthogonal ruler line. Vertical rulers provide X references and horizontal rulers provide Y references; diagonal rulers remain measurement-only. The target click applies immediately. The toolbar spacing is a non-negative clear gap between the nearest faces: a right/top target places the whole source outside to its right/top, a left/bottom target places it outside to its left/bottom, and top-cell boundaries place it inward. The last valid spacing is remembered for the next alignment, including after reopening the app. Only the source moves, and the operation creates one Undo entry.

For quick group alignment, Shift-click blocks on the canvas or in the instance list to build a multi-selection. The amber block is the fixed reference; plain-click another already-selected block to make it the primary reference without clearing the group. The Align menu also supports:

- Left, right, top, and bottom physical edges
- Horizontal and vertical physical centers
- Horizontal or vertical equal-gap distribution for three or more blocks

Every selected block moves to the chosen physical edge or center of the amber reference block. Alignment uses displayed transformed bounds, so rotated and mirrored blocks behave correctly. A complete alignment operation creates one Undo entry.

### 4. Measure and inspect spacing

Ruler mode supports grid and object-edge snapping. Press `o` for orthogonal measurement and click two snapped points to create a ruler. Double-clicking a block in Select mode opens and pins its Properties panel; double-clicking empty canvas fits the view.

Selecting a block shows its directly visible neighboring gaps in blue. Auto-Dim shows a violet nearest-gap overview only while nothing is selected; selecting an IP automatically suppresses the global network so only that IP’s focused dimensions remain. Labels use lighter text and thin endpoint ticks without extra point markers. Hovering a global dimension fades the others.

### 5. Save or export

- **Save SVG** (or `Ctrl/Cmd+S`) downloads a visual SVG that opens in a browser and embeds the editable project.
- **Open Project** accepts `.flp`, legacy JSON, or an SVG exported by this application.
- **Backup .flp** downloads a compact validated project file without the visual drawing.
- **Preview Code** displays the generated Cadence SKILL before download.

The Saved/Unsaved indicator tracks the last SVG save, `.flp` backup, or project open. The application warns before replacing unsaved work or closing the page.

Changing the placement grid re-snaps every existing instance to an exact multiple of the new grid. Coordinate fields, lists, SVG tables, and generated SKILL use precision derived from that grid. For example, `3452u` is valid on a `0.005u` grid because it equals exactly 690,400 grid steps; Cadence may display it as `3452.0000000u` according to its own display precision.

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
| `Ctrl/Cmd+S` | Save an editable, browser-viewable SVG |
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
