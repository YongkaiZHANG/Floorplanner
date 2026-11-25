import React, { useEffect, useState } from 'react';
import {
  FiAlignLeft,
  FiAlertTriangle,
  FiBarChart2,
  FiBox,
  FiChevronLeft,
  FiChevronRight,
  FiCpu,
  FiDownload,
  FiGrid,
  FiLayers,
  FiLock,
  FiMinimize2,
  FiMousePointer,
  FiMove,
  FiRotateCw,
  FiSave,
  FiSliders,
  FiX,
} from 'react-icons/fi';
import './TutorialModal.css';

interface TutorialModalProps {
  onClose: () => void;
  onLoadDemo?: () => void;
}

type TutorialTab = 'overview' | 'walkthrough' | 'features' | 'shortcuts';

const shortcutGroups: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'Navigation & View',
    items: [
      ['Scroll wheel', 'Zoom smoothly around pointer'],
      ['Right-drag', 'Zoom in to drawn region (Cadence style)'],
      ['Middle-drag / Space+drag', 'Pan the canvas'],
      ['Arrow keys / Shift+Arrow', 'Pan viewport (small / large step)'],
      ['F / Double-click canvas', 'Fit top cell to viewport'],
      ['G / Shift+G', 'Toggle drafting grid / Toggle Vis & Snap badge (fixed to Grid)'],
    ],
  },
  {
    title: 'Placement & Editing',
    items: [
      ['N', 'Create a Master IP / Cell View'],
      ['I', 'Instantiate a cell or editable Mosaic (cursor or 0,0)'],
      ['X / Shift+B', 'Descend Edit-in-Place into cell / Return up'],
      ['R / D', 'Draw Virtuoso rectangle on layer/purpose (when idle)'],
      ['L', 'Create Text Label on text/drawing or custom layer'],
      ['F4 / S', 'Partial Select shape edges / Stretch selected edges'],
      ['C', 'Interactive Copy of selected block(s) or shape (R rotates)'],
      ['F3 / Shift+Drag', 'Cycle Move Mode (Ortho default / Free / H / V) / Temp Free'],
      ['R / Shift+R', 'Rotate selected block or placing/copying ghost ±90°'],
      ['Right-click / Shift+Right', 'Rotate block, text, or copy group CW / CCW'],
      ['Shift + L', 'Lock or unlock selected blocks or shapes'],
      ['Alt + Arrow / +Shift', 'Nudge selection by 1× or 10× grid'],
      ['Ctrl/Cmd + C / X', 'Cut unlocked selected block(s) or shape to clipboard'],
      ['Ctrl/Cmd + V', 'Paste cut/copied block(s) or shape from clipboard'],
      ['Delete / Backspace', 'Delete unlocked selected blocks or shapes'],
    ],
  },
  {
    title: 'Alignment, Measurement & Project',
    items: [
      ['Shift + click / Drag box', 'Multi-select blocks for group drag or align'],
      ['A', 'Two-edge align to IP, die boundary, or ruler'],
      ['M', 'Return to Select mode'],
      ['K / Shift+K', 'Enter Ruler mode / Clear all rulers'],
      ['O', 'Toggle orthogonal ruler lock'],
      ['Q / Double-click block', 'Toggle & pin Properties inspector'],
      ['Ctrl/Cmd + Z / Shift+Z', 'Undo / Redo (also U / Ctrl+Y)'],
      ['Ctrl/Cmd + S', 'Save editable workspace in browser'],
      ['Ctrl/Cmd + A / Esc', 'Select all / Cancel or clear selection'],
    ],
  },
];

const walkthroughSteps = [
  {
    eyebrow: 'Step 01 · Architecture',
    title: 'Configure the die, seal-ring inset, and pixel array.',
    summary:
      'Set your Top Cell library, dimensions, and placement grid (such as 0.005 µm). Add an optional Seal-Ring Inset so every pad row attaches neatly inside the die perimeter, and enable a Pixel Array overlay for image-sensor planning.',
    tips: [
      'Origin (0, 0) sits at the physical center of the Top Cell with +Y pointing upward — matching Cadence Virtuoso.',
      'Double-click the Pixel Array anytime to edit its exact X, Y, Width, and Height in the Properties inspector.',
    ],
    diagram: (
      <svg viewBox="0 0 360 190" className="walkthrough-svg" aria-hidden="true">
        <rect x="24" y="16" width="312" height="158" rx="8" fill="#ffffff" stroke="#64748b" strokeWidth="2" strokeDasharray="7 5" />
        <rect x="40" y="30" width="280" height="130" rx="4" fill="none" stroke="#d97706" strokeWidth="1.5" strokeDasharray="4 4" />
        <rect x="92" y="44" width="176" height="84" rx="4" fill="rgba(139,92,246,0.14)" stroke="#8b5cf6" strokeWidth="1.8" strokeDasharray="5 4" />
        <line x1="180" y1="16" x2="180" y2="174" stroke="#cbd5e1" strokeWidth="1" />
        <line x1="24" y1="95" x2="336" y2="95" stroke="#cbd5e1" strokeWidth="1" />
        <circle cx="180" cy="95" r="3.5" fill="#0071e3" />
        {[0, 1, 2, 3, 4, 5].map(i => (
          <rect key={i} x={100 + i * 28} y="30" width="16" height="10" rx="1.5" fill="#f59e0b" />
        ))}
        <text x="180" y="90" textAnchor="middle" fill="#6d28d9" fontSize="11" fontWeight="700">PIXEL ARRAY</text>
        <text x="186" y="108" fill="#0071e3" fontSize="9.5" fontWeight="600">(0, 0)</text>
        <text x="290" y="152" textAnchor="end" fill="#b45309" fontSize="9.5" fontWeight="600">Seal-Ring Inset</text>
      </svg>
    ),
  },
  {
    eyebrow: 'Step 02 · Precision Alignment',
    title: 'Align single blocks or groups by clicking two edges.',
    summary:
      'Select one or more blocks and press A (or click Align). Pick any amber edge on the moving selection, enter an exact directional spacing in µm, and click any green reference — another IP edge, pixel-array edge, die boundary, or orthogonal ruler.',
    tips: [
      'Every selected block translates by the exact same delta, preserving internal spacing in one Undo step.',
      'Quick Align & Equal-Gap Distribute also respect transformed bounds for all eight Cadence orientations.',
    ],
    diagram: (
      <svg viewBox="0 0 360 190" className="walkthrough-svg" aria-hidden="true">
        <rect x="34" y="42" width="106" height="104" rx="6" fill="rgba(37,99,235,0.22)" stroke="#1e293b" strokeWidth="1.5" />
        <line x1="140" y1="42" x2="140" y2="146" stroke="#f59e0b" strokeWidth="4.5" strokeLinecap="round" />
        <rect x="220" y="54" width="106" height="92" rx="6" fill="rgba(16,185,129,0.18)" stroke="#1e293b" strokeWidth="1.5" />
        <line x1="220" y1="54" x2="220" y2="146" stroke="#10b981" strokeWidth="4.5" strokeLinecap="round" />
        <line x1="144" y1="95" x2="216" y2="95" stroke="#0071e3" strokeWidth="2" strokeDasharray="4 4" />
        <polygon points="216,95 208,90 208,100" fill="#0071e3" />
        <rect x="155" y="74" width="50" height="18" rx="9" fill="#0071e3" />
        <text x="180" y="86" textAnchor="middle" fill="#ffffff" fontSize="9.5" fontWeight="700">25 µm</text>
        <text x="87" y="98" textAnchor="middle" fill="#0f172a" fontSize="11" fontWeight="700">Source IP</text>
        <text x="273" y="104" textAnchor="middle" fill="#0f172a" fontSize="11" fontWeight="700">Reference</text>
      </svg>
    ),
  },
  {
    eyebrow: 'Step 03 · Group Control',
    title: 'Drag multi-selections together, rename, and lock blocks.',
    summary:
      'Marquee-drag or Shift-click to select a cluster of macros, then drag any selected block to move the entire group together. Rename instances meaningfully in Properties and press Shift+L to lock finalized blocks against accidental edits.',
    tips: [
      'Locked blocks show a gold lock indicator and cannot be dragged, rotated, aligned, nudged, or deleted.',
      'Use the Sidebar instance search and IP / Pad filter pills to locate blocks instantly on dense floorplans.',
    ],
    diagram: (
      <svg viewBox="0 0 360 190" className="walkthrough-svg" aria-hidden="true">
        <rect x="44" y="34" width="174" height="122" rx="8" fill="rgba(41,151,255,0.08)" stroke="#2997ff" strokeWidth="1.5" strokeDasharray="5 4" />
        <rect x="58" y="48" width="68" height="44" rx="5" fill="rgba(14,165,233,0.28)" stroke="#f59e0b" strokeWidth="2.5" />
        <rect x="136" y="48" width="68" height="44" rx="5" fill="rgba(14,165,233,0.28)" stroke="#38bdf8" strokeWidth="2.5" />
        <rect x="58" y="102" width="146" height="40" rx="5" fill="rgba(124,58,237,0.24)" stroke="#38bdf8" strokeWidth="2.5" />
        <rect x="242" y="48" width="84" height="94" rx="6" fill="rgba(245,158,11,0.18)" stroke="#d97706" strokeWidth="2" strokeDasharray="4 3" />
        <text x="284" y="92" textAnchor="middle" fill="#b45309" fontSize="10.5" fontWeight="700">LOCKED</text>
        <text x="284" y="107" textAnchor="middle" fill="#92400e" fontSize="9">I_PLL_BG</text>
        <text x="131" y="126" textAnchor="middle" fill="#0f172a" fontSize="10" fontWeight="700">Group Drag (3 blocks)</text>
      </svg>
    ),
  },
  {
    eyebrow: 'Step 04 · Metrology',
    title: 'Measure clearances with smart rulers and Auto-Dim.',
    summary:
      'Press K to place rulers with edge snapping, and press O for Ortho mode — matching vertical or horizontal edges lock perpendicular with a Cadence-style reference extension. Toggle Auto-Dim for a full gap overview, or select one IP for focused gaps and pixel-array overlaps.',
    tips: [
      'Toggle the adaptive drafting grid with G or use the floating bottom-center viewport pill to zoom and fit.',
      'Vertical and horizontal rulers double as alignment targets during two-edge alignment.',
    ],
    diagram: (
      <svg viewBox="0 0 360 190" className="walkthrough-svg" aria-hidden="true">
        <rect x="38" y="34" width="94" height="62" rx="5" fill="rgba(37,99,235,0.22)" stroke="#1e293b" strokeWidth="1.5" />
        <rect x="224" y="94" width="96" height="64" rx="5" fill="rgba(20,184,166,0.22)" stroke="#1e293b" strokeWidth="1.5" />
        <line x1="132" y1="65" x2="224" y2="65" stroke="#d97706" strokeWidth="2.2" />
        <line x1="224" y1="65" x2="224" y2="126" stroke="#d97706" strokeWidth="1.8" strokeDasharray="4 3" />
        <circle cx="224" cy="126" r="4" fill="#d97706" stroke="#ffffff" strokeWidth="1.5" />
        <line x1="132" y1="57" x2="132" y2="73" stroke="#d97706" strokeWidth="2" />
        <line x1="224" y1="57" x2="224" y2="73" stroke="#d97706" strokeWidth="2" />
        <text x="178" y="56" textAnchor="middle" fill="#b45309" fontSize="10.5" fontWeight="700">L: 92 µm</text>
        <text x="272" y="130" textAnchor="middle" fill="#0f172a" fontSize="10" fontWeight="700">Ref Edge</text>
      </svg>
    ),
  },
  {
    eyebrow: 'Step 05 · Hierarchy, Verification & Virtuoso',
    title: 'Edit in Place, check die bounds, and export clean SKILL.',
    summary:
      'Press X to Descend Edit-in-Place inside any hierarchical cell (like padring or asp_top) directly in your current view. Out-of-bounds instances show live amber warnings, while bounding-box overlaps are shown calmly inside each IP’s Properties panel (non-fatal and never emitted to SKILL).',
    tips: [
      'Content-driven cells (padring, asp_top, PAD) export only their drawn shapes and sub-instances — no synthetic prBoundary boxes.',
      'Exported SVGs embed the complete editable project so any teammate can view or re-import them losslessly.',
    ],
    diagram: (
      <svg viewBox="0 0 360 190" className="walkthrough-svg" aria-hidden="true">
        <rect x="36" y="42" width="98" height="96" rx="5" fill="rgba(37,99,235,0.2)" stroke="#1e293b" strokeWidth="1.5" />
        <rect x="106" y="64" width="96" height="86" rx="5" fill="rgba(14,165,233,0.16)" stroke="#0284c7" strokeWidth="1.8" strokeDasharray="5 3" />
        <rect x="44" y="138" width="84" height="16" fill="rgba(245,158,11,0.26)" stroke="#f59e0b" strokeWidth="1.8" strokeDasharray="4 3" />
        <rect x="226" y="42" width="102" height="108" rx="8" fill="#0f172a" stroke="#334155" strokeWidth="1.5" />
        <text x="238" y="64" fill="#38bdf8" fontSize="9" fontFamily="monospace">FPCreateFloorplan()</text>
        <text x="238" y="82" fill="#94a3b8" fontSize="8.5" fontFamily="monospace">dbCreateRect/Label</text>
        <text x="238" y="98" fill="#4ade80" fontSize="8.5" fontFamily="monospace">Preserve Masters</text>
        <text x="238" y="114" fill="#fbbf24" fontSize="8.5" fontFamily="monospace">CSV + SVG Export</text>
        <text x="120" y="170" textAnchor="middle" fill="#b45309" fontSize="9.5" fontWeight="700">Boundary Warning + EIP</text>
      </svg>
    ),
  },
];

export const TutorialModal: React.FC<TutorialModalProps> = ({ onClose, onLoadDemo }) => {
  const [activeTab, setActiveTab] = useState<TutorialTab>('overview');
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const currentStep = walkthroughSteps[stepIndex];

  return (
    <div className="modal-overlay tutorial-overlay" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-content glass-panel tutorial-modal" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
        <header className="tutorial-header">
          <div className="tutorial-hero">
            <span className="tutorial-eyebrow">IC Floorplanner · Pro Workflow Guide</span>
            <h2 id="tutorial-title">Silicon floorplanning. Engineered for precision.</h2>
            <p>Plan die geometry, pad rings, pixel arrays, and Cadence Virtuoso SKILL hierarchies right in your browser — with zero server uploads.</p>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close tutorial"><FiX /></button>
        </header>

        <nav className="tutorial-tabs" role="tablist" aria-label="Guide sections">
          {([
            ['overview', 'Overview'],
            ['walkthrough', 'Interactive Walkthrough'],
            ['features', 'Pro Features'],
            ['shortcuts', 'Shortcuts'],
          ] as Array<[TutorialTab, string]>).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              className={`tutorial-tab${activeTab === id ? ' active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="tutorial-scroll">
          {activeTab === 'overview' && (
            <>
              <section className="tutorial-section">
                <div className="tutorial-bento">
                  <article className="bento-card bento-card--blue">
                    <FiCpu />
                    <h4>Cadence-Native Geometry</h4>
                    <p>Center-origin (+Y up) coordinates, all 8 orientations, canonical grid snapping, and real OpenAccess <code>prBoundary</code> SKILL export.</p>
                  </article>
                  <article className="bento-card bento-card--amber">
                    <FiAlignLeft />
                    <h4>Two-Edge &amp; Group Alignment</h4>
                    <p>Shift single blocks or multi-selections with directional edge spacing against IPs, pixel arrays, die edges, or orthogonal rulers.</p>
                  </article>
                  <article className="bento-card bento-card--violet">
                    <FiLayers />
                    <h4>CIS Pixel Array &amp; Seal Ring</h4>
                    <p>Reserve perimeter seal-ring inset for auto/manual pad rings and inspect outside gaps, inside clearance, and partial array overlaps.</p>
                  </article>
                  <article className="bento-card bento-card--rose">
                    <FiBarChart2 />
                    <h4>Boundary Check, Metrics &amp; CSV</h4>
                    <p>Live amber warnings when cells exceed die bounds, non-fatal overlap notices in Properties (padring-safe), area utilization, and CSV export.</p>
                  </article>
                </div>
              </section>

              <section className="tutorial-section">
                <h3>Five-step workflow</h3>
                <ol className="tutorial-steps">
                  <li><span>1</span><div><strong>Configure Top Cell</strong><p>Set library, cell name, die size, grid, and optional seal-ring inset.</p></div></li>
                  <li><span>2</span><div><strong>Create &amp; Draw Cells</strong><p>Create empty Virtuoso cellviews (<code>N</code>), draw rectangles (<code>R</code>) or text labels (<code>L</code>), and build hierarchy.</p></div></li>
                  <li><span>3</span><div><strong>Place, Descend &amp; Align</strong><p>Instantiate cells (<code>I</code>), Edit-in-Place (<code>X</code>), stretch edges (<code>F4</code>/<code>S</code>), or align to IPs &amp; die boundaries (<code>A</code>).</p></div></li>
                  <li><span>4</span><div><strong>Measure &amp; Check</strong><p>Use ortho rulers (<code>K</code>/<code>O</code>), Auto-Dim, Summary metrics, and live boundary warnings.</p></div></li>
                  <li><span>5</span><div><strong>Save &amp; Export</strong><p>Save locally, share editable SVGs, download CSV tables, or export clean Virtuoso SKILL.</p></div></li>
                </ol>
              </section>

              <section className="tutorial-section">
                <h3>Canvas visual legend</h3>
                <div className="tutorial-legend">
                  <span><i className="tutorial-dot tutorial-dot--anchor" />Amber: primary selection, source edge &amp; out-of-bounds warning</span>
                  <span><i className="tutorial-dot tutorial-dot--selected" />Blue: multi-selected blocks &amp; Edit-in-Place context</span>
                  <span><i className="tutorial-dot tutorial-dot--target" />Green: alignment reference (IP, die boundary, ruler)</span>
                  <span><i className="tutorial-dot tutorial-dot--dimension" />Violet: Auto-Dim / Pixel Array</span>
                </div>
              </section>
            </>
          )}

          {activeTab === 'walkthrough' && (
            <section className="walkthrough-panel">
              <div className="walkthrough-stage">
                <div className="walkthrough-visual">
                  {currentStep.diagram}
                </div>
                <div className="walkthrough-copy">
                  <span className="tutorial-eyebrow">{currentStep.eyebrow}</span>
                  <h3>{currentStep.title}</h3>
                  <p>{currentStep.summary}</p>
                  <ul className="walkthrough-tips">
                    {currentStep.tips.map(tip => <li key={tip}>{tip}</li>)}
                  </ul>
                </div>
              </div>

              <div className="walkthrough-controls">
                <button
                  type="button"
                  className="btn"
                  disabled={stepIndex === 0}
                  onClick={() => setStepIndex(index => Math.max(0, index - 1))}
                >
                  <FiChevronLeft /> Previous
                </button>
                <div className="walkthrough-dots" role="tablist" aria-label="Walkthrough steps">
                  {walkthroughSteps.map((step, index) => (
                    <button
                      key={step.eyebrow}
                      type="button"
                      className={`walkthrough-dot${index === stepIndex ? ' active' : ''}`}
                      onClick={() => setStepIndex(index)}
                      aria-label={`Go to step ${index + 1}: ${step.title}`}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    if (stepIndex < walkthroughSteps.length - 1) setStepIndex(index => index + 1);
                    else onClose();
                  }}
                >
                  {stepIndex < walkthroughSteps.length - 1 ? <>Next <FiChevronRight /></> : 'Done'}
                </button>
              </div>
            </section>
          )}

          {activeTab === 'features' && (
            <section className="tutorial-section">
              <div className="tutorial-card-grid">
                <article className="tutorial-card">
                  <FiMove />
                  <div><strong>Orthogonal Move Modes &amp; Multi-Copy (C / F3)</strong><p>Dragging defaults to Virtuoso Orthogonal move (cycle Ortho / Free / Horiz / Vert with <kbd>F3</kbd> or hold <kbd>Shift</kbd> for temporary Free). Press <kbd>C</kbd> to interactively copy multiple selected objects together, or <kbd>Ctrl+C</kbd> / <kbd>Ctrl+V</kbd> to cut and paste.</p></div>
                </article>
                <article className="tutorial-card">
                  <FiGrid />
                  <div><strong>Editable Mosaic Cells (dbCreateSimpleMosaic)</strong><p>Create live array mosaics from Create Instance (<kbd>I</kbd>) or turn any placed instance into a mosaic in Properties — adjust rows, columns, and ΔX / ΔY pitch anytime, flatten when needed, and export native <code>dbCreateSimpleMosaic</code> SKILL.</p></div>
                </article>
                <article className="tutorial-card">
                  <FiLock />
                  <div><strong>Rename &amp; lock instances</strong><p>Give blocks and pads meaningful Virtuoso names in Properties. Press <kbd>Shift+L</kbd> or click Lock to protect finalized placements from accidental drags, rotations, or deletes.</p></div>
                </article>
                <article className="tutorial-card">
                  <FiRotateCw />
                  <div><strong>Center-stable rotation</strong><p>Right-click a block to rotate 90° clockwise; Shift-right-click rotates counterclockwise. Mirrored blocks remain in the mirrored orientation family.</p></div>
                </article>
                <article className="tutorial-card">
                  <FiGrid />
                  <div><strong>Edge pads with seal-ring inset</strong><p>Define an optional seal-ring margin (µm) in Top Cell or Place Edge Pads. Both automatic rows and auto-rotating manual groups attach cleanly to the inner pad ring.</p></div>
                </article>
                <article className="tutorial-card">
                  <FiSliders />
                  <div><strong>Pixel Array inspector</strong><p>Select or double-click the Pixel Array to edit exact X, Y, Width, and Height in the Properties panel, or toggle visibility without losing its saved geometry.</p></div>
                </article>
                <article className="tutorial-card">
                  <FiLayers />
                  <div><strong>Virtuoso Edit-in-Place (X) &amp; Stretch (S)</strong><p>Select any instance and press <kbd>X</kbd> to edit its internals right inside the current view (press <kbd>Shift+B</kbd> to return). Press <kbd>F4</kbd> or <kbd>S</kbd> to partially select and stretch rectangle edges.</p></div>
                </article>
                <article className="tutorial-card">
                  <FiAlignLeft />
                  <div><strong>Boundary &amp; Two-Edge Alignment (A)</strong><p>Align single blocks, groups, or Edit-in-Place sub-cells directly to die boundaries from the Align menu, or press <kbd>A</kbd> to snap edges with exact directional spacing.</p></div>
                </article>
                <article className="tutorial-card">
                  <FiAlertTriangle />
                  <div><strong>Boundary Warnings &amp; Non-Fatal Overlaps</strong><p>Cells extending outside the die show live amber warnings. Bounding-box overlaps (normal for <code>padring</code> or <code>asp_top</code>) appear calmly inside Properties and are not exported to SKILL.</p></div>
                </article>
                <article className="tutorial-card">
                  <FiMinimize2 />
                  <div><strong>Ortho rulers &amp; extensions</strong><p>Enable Ortho (<kbd>O</kbd>) and snap two matching vertical or horizontal edges to measure separation with a Cadence-style perpendicular reference extension.</p></div>
                </article>
                <article className="tutorial-card">
                  <FiDownload />
                  <div><strong>Non-destructive SKILL export</strong><p>In Preview Code, enable <em>Preserve existing masters</em> to skip overwriting populated layouts, and choose between origin-anchored IP wrappers or direct top-cell placement.</p></div>
                </article>
                <article className="tutorial-card">
                  <FiMousePointer />
                  <div><strong>Fixed Virtuoso grid &amp; viewport HUD</strong><p>Toggle the drafting grid (<kbd>G</kbd>) locked to your exact defined grid spacing (zoom-invariant), and use the floating bottom pill for Move Mode (<kbd>F3</kbd>), zoom, 100% fit, and live cursor coordinates.</p></div>
                </article>
                <article className="tutorial-card">
                  <FiSave />
                  <div><strong>Editable SVG round-trip</strong><p>Every exported SVG embeds full project metadata (including pad inset and locked flags) so teammates can view it in any browser or re-import it losslessly.</p></div>
                </article>
              </div>
              <aside className="tutorial-warning">
                <FiBox />
                <p><strong>Cadence Virtuoso note:</strong> ensure the Top Cell library already exists in <code>cds.lib</code> and is technology-attached before running <code>load("...")</code>. Canvas colors are visual aids; Virtuoso display colors follow your tech file.</p>
              </aside>
            </section>
          )}

          {activeTab === 'shortcuts' && (
            <section className="tutorial-section">
              <div className="shortcut-groups">
                {shortcutGroups.map(group => (
                  <div key={group.title} className="shortcut-group">
                    <h4>{group.title}</h4>
                    <div className="tutorial-shortcuts">
                      {group.items.map(([key, action]) => (
                        <div key={key}><kbd>{key}</kbd><span>{action}</span></div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <footer className="tutorial-footer">
          <span>Open this guide anytime from <strong>Help</strong> in the top bar.</span>
          <div className="tutorial-footer__actions">
            {onLoadDemo && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  onLoadDemo();
                  onClose();
                }}
              >
                <FiCpu /> Load Live CIS Demo
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={onClose}>Start Planning</button>
          </div>
        </footer>
      </div>
    </div>
  );
};
