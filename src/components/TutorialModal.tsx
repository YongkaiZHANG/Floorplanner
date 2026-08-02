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
            <li><span>2</span><div><strong>Create Master IPs</strong><p>Use the left sidebar’s + button to define reusable blocks, dimensions, planning colors, fill transparency, and outline style. Their library automatically follows the Top Cell.</p></div></li>
            <li><span>3</span><div><strong>Place instances</strong><p>Click a master’s crosshair or press <kbd>i</kbd>, then click the canvas. Press <kbd>Esc</kbd> when finished.</p></div></li>
            <li><span>4</span><div><strong>Arrange and inspect</strong><p>Select one or several objects to move, click Align (or press a), choose any selected edge, then click a green IP, top-cell, or ruler reference. The target click applies immediately.</p></div></li>
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
              <div><strong>Rotate safely</strong><p>Right-click an IP or pad to rotate it 90° clockwise; Shift-right-click rotates counterclockwise. Pad edge attachment uses the rotated physical footprint, including swapped width and height at R90/R270.</p></div>
            </article>
            <article className="tutorial-card">
              <FiAlignLeft />
              <div><strong>Align by edges</strong><p>Select one or several moving objects and click Align. Pick an amber edge from any selected object, then a green reference. Every selected object shifts by the same delta. Spacing is directional: selected + spacing = reference when selected is left/below; reference + spacing = selected when selected is right/above.</p></div>
            </article>
            <article className="tutorial-card">
              <FiLayers />
              <div><strong>Read Auto-Dim</strong><p>Selecting an IP shows focused blue gaps. With a visible pixel array, outside edges show gaps, fully contained edges show inside clearance, and partially embedded edges show the penetration depth as “overlap.” Hiding the array removes those distances.</p></div>
            </article>
            <article className="tutorial-card">
              <FiGrid />
              <div><strong>Place edge pads</strong><p>Automatic Row rotates by edge by default. Shift is measured from the Top Cell’s left edge for top/bottom rows, or bottom edge for left/right rows, to the first pad’s physical edge. Manual / Separated places flexible pitched groups with arbitrary gaps. Every instance reuses one Cadence pad cell.</p></div>
            </article>
            <article className="tutorial-card">
              <FiGrid />
              <div><strong>Place and align a pixel array</strong><p>Define and place the region, then select it and use Align exactly like an IP. Its selected edge can align to an IP, top boundary, pixel-array reference, or ruler, and overlap with IPs is allowed.</p></div>
            </article>
            <article className="tutorial-card">
              <FiSave />
              <div><strong>Protect your work</strong><p>Save stores the current editable workspace in this browser. Exported SVGs also embed project metadata and can be imported later.</p></div>
            </article>
            <article className="tutorial-card">
              <FiDownload />
              <div><strong>Export to Virtuoso</strong><p>SKILL creates the complete hierarchy in the Top Cell library. A visible pixel array is emitted on the drawing layers; a hidden one is omitted.</p></div>
            </article>
          </div>
        </section>

        <section className="tutorial-section">
          <h3>Selection colors</h3>
          <div className="tutorial-legend">
            <span><i className="tutorial-dot tutorial-dot--anchor" />Amber: moving selection and chosen source edge</span>
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
          <p><strong>Cadence export note:</strong> the Top Cell library must already exist and be technology-attached. Canvas colors are planning aids; geometry, orientation, and visible pixel-array drawing follow the export.</p>
        </aside>
      </div>

      <footer className="tutorial-footer">
        <span>Open this guide anytime from <strong>Help</strong> in the top bar.</span>
        <button className="btn btn-primary" onClick={onClose}>Start planning</button>
      </footer>
    </div>
  </div>
);
