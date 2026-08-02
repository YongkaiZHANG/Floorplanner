import React from 'react';
import {
  FiAlignLeft,
  FiBox,
  FiDownload,
  FiLayers,
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
  ['r / Shift + r', 'Rotate ±90°'],
  ['k', 'Measure with a ruler'],
  ['o', 'Toggle orthogonal ruler'],
  ['Ctrl/Cmd + Z', 'Undo'],
  ['Ctrl/Cmd + Shift + Z', 'Redo'],
  ['Ctrl/Cmd + S', 'Save the project'],
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
            <li><span>2</span><div><strong>Create Master IPs</strong><p>Use the left sidebar’s + button to define reusable blocks, dimensions, and planning colors.</p></div></li>
            <li><span>3</span><div><strong>Place instances</strong><p>Click a master’s crosshair or press <kbd>i</kbd>, then click the canvas. Press <kbd>Esc</kbd> when finished.</p></div></li>
            <li><span>4</span><div><strong>Arrange and inspect</strong><p>Shift-click blocks, choose the amber primary reference, then use Align. Measure remaining gaps with Auto-Dim or rulers.</p></div></li>
            <li><span>5</span><div><strong>Save and export</strong><p>Save an editable `.flp`, preview SKILL, then export only after checking destination libraries.</p></div></li>
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
              <div><strong>Rotate safely</strong><p>Drag the blue handle above a single selection. Rotation snaps to legal Cadence quarter turns and preserves its center.</p></div>
            </article>
            <article className="tutorial-card">
              <FiAlignLeft />
              <div><strong>Align to a reference</strong><p>The amber block is fixed. Plain-click another already-selected block to make it primary, then align all blue blocks to its chosen edge or center.</p></div>
            </article>
            <article className="tutorial-card">
              <FiLayers />
              <div><strong>Read Auto-Dim</strong><p>Violet dimensions show nearest visible gaps and name both IPs. Hover one dimension to fade the others. Blue dimensions belong to the selected IP.</p></div>
            </article>
            <article className="tutorial-card">
              <FiSave />
              <div><strong>Protect your work</strong><p>Save creates a validated `.flp`. SVG also carries editable metadata. Undo and Redo cover geometry, masters, rulers, and alignment.</p></div>
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
