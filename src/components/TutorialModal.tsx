import React from 'react';
import {
  FiAlignLeft,
  FiBox,
  FiDownload,
  FiLayers,
  FiGrid,
  FiMousePointer,
  FiRotateCw,
  FiSave,
  FiX,
} from 'react-icons/fi';
import './TutorialModal.css';

interface TutorialModalProps {
  onClose: () => void;
}

const shortcuts = [
  ['n', 'Create a Master IP'],
  ['i', 'Place an instance'],
  ['Shift + click', 'Build a multi-selection'],
  ['a', 'Align selected IP by two edges'],
  ['r / Shift + r', 'Rotate ±90°'],
  ['k', 'Measure with a ruler'],
  ['o', 'Toggle orthogonal ruler'],
  ['Ctrl/Cmd + Z', 'Undo'],
  ['Ctrl/Cmd + Shift + Z', 'Redo'],
  ['Ctrl/Cmd + S', 'Save the browser workspace'],
  ['f', 'Fit the top cell'],
  ['Delete', 'Delete the selection'],
  ['Esc', 'Cancel or clear selection'],
];

export const TutorialModal: React.FC<TutorialModalProps> = ({ onClose }) => (
  <div className="modal-overlay tutorial-overlay">
    <div className="modal-content glass-panel tutorial-modal" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <header className="tutorial-header">
        <div>
          <span className="tutorial-eyebrow">Quick start</span>
          <h2 id="tutorial-title">Welcome to IC Floorplanner</h2>
          <p>Build a Cadence-ready hierarchy without losing track of coordinates, transforms, or spacing.</p>
        </div>
        <button className="modal-close-btn" onClick={onClose} aria-label="Close tutorial"><FiX /></button>
      </header>

      <div className="tutorial-scroll">
        <section className="tutorial-section">
          <h3>Build your first floorplan</h3>
          <ol className="tutorial-steps">
            <li><span>1</span><div><strong>Configure the Top Cell</strong><p>Set its Cadence library, cell name, width, height, and placement grid.</p></div></li>
            <li><span>2</span><div><strong>Create Master IPs</strong><p>Use the left sidebar’s + button to define reusable blocks, dimensions, planning colors, fill transparency, and outline style.</p></div></li>
            <li><span>3</span><div><strong>Place instances</strong><p>Click a master’s crosshair or press <kbd>i</kbd>, then click the canvas. Press <kbd>Esc</kbd> when finished.</p></div></li>
            <li><span>4</span><div><strong>Arrange and inspect</strong><p>Select the IP to move, click Align (or press a), choose its edge, then click a green IP, top-cell, or ruler reference. The target click applies immediately.</p></div></li>
            <li><span>5</span><div><strong>Save, import, and export</strong><p>Save keeps the working project in this browser. Import SVG opens an editable project file; Export SVG creates a visual copy for review.</p></div></li>
          </ol>
        </section>

        <section className="tutorial-section">
          <h3>Essential interactions</h3>
          <div className="tutorial-card-grid">
            <article className="tutorial-card">
              <FiMousePointer />
              <div><strong>Select and edit</strong><p>Click a block for Properties. Double-click it to open and pin Properties immediately. Middle-drag pans; the wheel zooms.</p></div>
            </article>
            <article className="tutorial-card">
              <FiRotateCw />
              <div><strong>Rotate safely</strong><p>Right-click an IP to rotate it 90° clockwise; Shift-right-click rotates counterclockwise. You can also use r / Shift+r or the Properties panel.</p></div>
            </article>
            <article className="tutorial-card">
              <FiAlignLeft />
              <div><strong>Align by edges</strong><p>Select the moving source and click Align. Pick its alignment axis, then click the green side where it should be placed. Spacing is the clear gap between the two nearest faces.</p></div>
            </article>
            <article className="tutorial-card">
              <FiLayers />
              <div><strong>Read Auto-Dim</strong><p>With no selection, violet lines give the nearest-gap overview. Selecting an IP hides that network and shows only its focused blue dimensions, so labels do not compete.</p></div>
            </article>
            <article className="tutorial-card">
              <FiGrid />
              <div><strong>Place edge pads</strong><p>Click Place edge pads under Top Cell, choose an edge visually, then use Fill edge or enter a count and pitch. Pads remain attached when dragged around the perimeter.</p></div>
            </article>
            <article className="tutorial-card">
              <FiSave />
              <div><strong>Protect your work</strong><p>Save stores the current editable workspace in this browser. Exported SVGs also embed project metadata and can be imported later.</p></div>
            </article>
            <article className="tutorial-card">
              <FiDownload />
              <div><strong>Export to Virtuoso</strong><p>SKILL creates or overwrites layout cellviews. Required libraries must already exist and be attached to the intended technology.</p></div>
            </article>
          </div>
        </section>

        <section className="tutorial-section">
          <h3>Selection colors</h3>
          <div className="tutorial-legend">
            <span><i className="tutorial-dot tutorial-dot--anchor" />Amber: primary alignment reference</span>
            <span><i className="tutorial-dot tutorial-dot--selected" />Blue: additional selected blocks</span>
            <span><i className="tutorial-dot tutorial-dot--target" />Green: alignment target</span>
            <span><i className="tutorial-dot tutorial-dot--dimension" />Violet: Auto-Dim gap</span>
          </div>
        </section>

        <section className="tutorial-section">
          <h3>Keyboard reference</h3>
          <div className="tutorial-shortcuts">
            {shortcuts.map(([key, action]) => <div key={key}><kbd>{key}</kbd><span>{action}</span></div>)}
          </div>
        </section>

        <aside className="tutorial-warning">
          <FiBox />
          <p><strong>Cadence export note:</strong> canvas colors are planning aids. Virtuoso colors come from its technology/display configuration, while geometry and orientation follow the exported database transforms.</p>
        </aside>
      </div>

      <footer className="tutorial-footer">
        <span>Open this guide anytime from <strong>Help</strong> in the top bar.</span>
        <button className="btn btn-primary" onClick={onClose}>Start planning</button>
      </footer>
    </div>
  </div>
);
