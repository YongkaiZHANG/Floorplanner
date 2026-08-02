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
- Edge-bound pads with automatic rows for regular pitch plus manual placement for separated groups, irregular gaps, and keep-out regions.
- Optional pixel-array region with grid-snapped sizing, click placement, bounded dragging, edge alignment, IP overlap, and a non-destructive visibility toggle.
- Selected-IP dimensions include clearances to every visible pixel-array edge; hidden arrays are excluded from measurement and export.
- One authoritative hierarchy library: every IP and pad follows the Top Cell library automatically.
- Per-master planning appearance with custom color, fill transparency, and solid, dashed, dotted, or hidden outlines.
- Browser-viewable SVG save with an embedded project payload for lossless re-import.
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

Use the Top Cell settings to define the destination library, cell name, width, and height. The top-cell origin is at its physical center. The Top Cell library is authoritative for the complete generated hierarchy: IP and pad dialogs show it as read-only, imported masters are normalized to it, and changing it updates all existing masters in one Undo/Redo operation.

Create Master IP definitions in the left sidebar. Each master has:

- The inherited Top Cell library and a unique cell name
- Width and height in micrometers
- A canvas color selected from the extended palette or custom color picker
- Fill transparency and a solid, dashed, dotted, or hidden planning outline

Master geometry uses `(0, 0)` as its local origin. SKILL export preserves each canvas transform inside an automatically generated placed wrapper, then instantiates that wrapper in the Top Cell at `(0, 0)`.

Click **Place edge pads** under Top Cell and choose one of two methods. **Automatic Row** enables **Auto by edge** by default, using R0 on top, R270 on right, R180 on bottom, and R90 on left; disabling it allows an explicit orientation. The displayed physical footprint, pitch validation, row span, and edge attachment all use the resolved rotation. Automatic shift is measured from the chosen Top Cell edge start to the first pad’s physical edge: from the left boundary for top/bottom rows, or from the bottom boundary for left/right rows. Thus a 300 um left-side shift places the first pad’s bottom edge exactly 300 um above the Top Cell’s bottom edge, regardless of rotation. The dialog also shows resolved centered canvas coordinates; **Center row** calculates equal end margins and **Fill edge** sets the shift to zero. **Manual / Separated** defines a flexible group count and pitch, then attaches the complete group preview to the cursor. The preview automatically rotates as it moves between edges—top R0, right R270, bottom R180, and left R90—and each click stores that resolved orientation. Leave a keep-out gap of any size, click the next group on the same or another edge, and press Esc when finished. Both methods reuse the pad master, while SKILL collects every placed pad into one generated `<TopCell>_PAD_BANK` cell and places that bank once at `(0,0)` in the Top Cell.

Click **Enable Pixel Array** under Top Cell to define an optional active-array region. Enter a width and height smaller than the top cell, confirm, then click the desired canvas location. The dimensions and bottom-left origin are normalized to the placement grid, the complete region remains inside the top cell, and dragging keeps it bounded. The pixel array is intentionally allowed to overlap IP instances. For exact placement, select the pixel array and click **Align** (or press `a`), choose its amber edge, then choose a green IP edge, top-cell boundary, or orthogonal ruler. Conversely, an IP may use a pixel-array edge as its fixed reference. Unlike normal IP-to-IP spacing, the chosen pixel-array source edge is preserved so a zero offset can coincide with a reference while the array overlaps the IP. **Disable Pixel Array** hides it without forgetting its size or position; enable it again to restore the same region. The move control attaches the existing size to the cursor, while Settings supports resize, relocation, or removal.

### 2. Place and edit instances

Click the crosshair beside a master or press `i` to attach an instance to the cursor. Placement remains active for repeated placement until cancelled.

Select a block to edit exact X/Y coordinates and orientation in the Properties panel. Rotation is available in three ways:

- Right-click an IP or pad to rotate clockwise; Shift-right-click rotates counterclockwise
- Use the ±90° buttons in Properties
- Press `r` or `Shift+r`

Mouse rotation snaps to legal Cadence quarter turns and keeps the block's physical center stable. Mirrored instances stay in the mirrored orientation family.

### 3. Select and arrange blocks

For Cadence-style alignment, first select the object or objects that should move. Click **Align** (or press `a`); the compact alignment controls replace the right side of the top toolbar so no window covers the canvas. Every selected object exposes amber edges, so the controlling edge may be chosen from any member of a multi-selection. Then click a compatible green reference: another IP side, a visible pixel-array edge, a top-cell boundary, or an orthogonal ruler line. Vertical rulers provide X references and horizontal rulers provide Y references; diagonal rulers remain measurement-only. The entered spacing is a directional edge-to-edge distance: when the selected edge is below/left of the reference, `selected edge + spacing = reference edge`; when it is above/right, `reference edge + spacing = selected edge`. The clicked source edge is never silently replaced. Every selected object receives the same X/Y delta, preserving the group arrangement, and the whole operation creates one Undo entry. Edge-bound pads may participate as long as the shared shift keeps every pad on the top-cell perimeter. The last valid spacing is remembered after reopening the app.

For quick group alignment, Shift-click blocks on the canvas or in the instance list to build a multi-selection. The amber block is the fixed reference; plain-click another already-selected block to make it the primary reference without clearing the group. The Align menu also supports:

- Left, right, top, and bottom physical edges
- Horizontal and vertical physical centers
- Horizontal or vertical equal-gap distribution for three or more blocks

Every selected block moves to the chosen physical edge or center of the amber reference block. Alignment uses displayed transformed bounds, so rotated and mirrored blocks behave correctly. A complete alignment operation creates one Undo entry.

### 4. Measure and inspect spacing

Ruler mode supports grid and object-edge snapping. Toggle **Ortho** (or press `o`) and click two snapped points to create a ruler. Matching edge directions override the cursor’s dominant travel: two vertical IP edges report their left/right X separation, and two horizontal edges report their top/bottom Y separation, even when the IP projections do not overlap. A Cadence-style perpendicular extension grows from the measured segment to the exact snapped point on the reference edge, so one ruler identifies both edges without adding a second measurement. The extension is retained in saved projects and exported SVGs. Double-clicking a block in Select mode opens and pins its Properties panel; double-clicking empty canvas fits the view.

Selecting a block shows its directly visible neighboring gaps in blue. If the pixel array is visible, the focused view classifies every relevant IP edge independently: an outside edge shows its gap to the array, an IP fully inside shows clearance to each array edge, and an edge that crosses into the array shows the penetration depth from the crossed array boundary to that embedded IP edge as an **overlap** dimension. Partial corner overlaps are handled through their actual shared projection. The translucent pixel array does not hide IP-to-IP relationships, and hiding it removes all array measurements immediately. Auto-Dim shows a violet nearest-gap overview only while nothing is selected; selecting an IP suppresses the global network so only that IP’s focused dimensions remain.

### 5. Save or export

- **Save** (or `Ctrl/Cmd+S`) stores the current editable workspace in this browser and restores it on the next visit.
- **Import SVG** opens an editable SVG project exported by this application.
- **Export SVG** downloads a browser-viewable drawing with editable project data embedded inside it.
- **Preview Code** displays the generated Cadence SKILL before download.

Pixel-array visibility is honored consistently. When enabled, the region is drawn in the exported SVG and emitted in a same-library `<TopCell>_PIXEL_ARRAY` cell that is placed at `(0,0)` in the Top Cell. When disabled, no pixel-array cell, drawing, label, or Top Cell instance is emitted, although its saved size and position remain in the editable project payload so it can be restored later.

The Saved/Unsaved indicator tracks the browser workspace. Exporting a review copy does not silently mark later modifications as saved. The application warns before replacing unsaved work or closing the page.

Changing the placement grid re-snaps every existing instance to an exact multiple of the new grid. Coordinate fields, lists, SVG tables, and generated SKILL use precision derived from that grid. For example, `3452u` is valid on a `0.005u` grid because it equals exactly 690,400 grid steps; Cadence may display it as `3452.0000000u` according to its own display precision.

## Cadence Virtuoso export

Before exporting, ensure the single Top Cell library exists in `cds.lib` and is attached to the intended technology library. All generated IP and pad cellviews are created in that same library.

1. Open **Preview Code** and inspect the destination libraries and cell names.
2. Download the `.il` file.
3. In the Virtuoso CIW, run:

```skill
load("/absolute/path/to/top_cell.il")
```

Loading the file calls `FPCreateFloorplan()` automatically. It creates or overwrites the generated `layout` cellviews using `maskLayout`, creates real `prBoundary` objects, and opens masters read-only. Each non-pad IP gets a placed wrapper named from its cell, such as `<TopCell>_ADC_PLACED`; repeated placements of the same IP use numeric suffixes rather than opaque instance names such as `I3`. The wrapper contains the original master at the exact canvas coordinate and orientation, plus explicit upright name and `width x height um` labels on `("text" "drawing")` at the transformed physical center. Label heights adapt to the displayed IP height, available width, and text length. The Top Cell instantiates every wrapper at `(0,0)` with `R0`. All pads are contained in one `<TopCell>_PAD_BANK` cell, also instantiated once at `(0,0)`.

When the pixel array is enabled, SKILL creates `<TopCell>_PIXEL_ARRAY` in the same Top Cell library, writes its exact absolute-coordinate rectangle on `("prBoundary" "drawing")` and label on `("text" "drawing")`, then places the pixel-array cell at `(0,0)` in the Top Cell. Disabling the array omits that generated cell and instance while keeping the saved configuration available for later re-enabling. If an automatically generated cell name conflicts with an existing master name, the exporter adds a numeric suffix.

> **Important:** the generated script uses write mode and can overwrite existing layout views with matching library/cell names. Review the preview before loading it.

Geometry, hierarchy, coordinates, and orientation are portable. Canvas colors are visual planning aids; Virtuoso display colors come from the destination technology and display resource configuration.

## Keyboard and mouse controls

| Input | Action |
| --- | --- |
| Mouse wheel | Zoom around the pointer |
| Middle-drag | Pan the canvas |
| Arrow keys | Pan the view by a consistent screen distance |
| `Shift` + Arrow keys | Pan the view by a larger step |
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
| `Ctrl/Cmd+S` | Save the editable browser workspace |
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
