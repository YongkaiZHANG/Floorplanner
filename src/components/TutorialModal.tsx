import React from 'react';
import { FiX, FiCommand, FiMousePointer, FiLayers, FiDownload } from 'react-icons/fi';

interface TutorialModalProps {
  onClose: () => void;
}

export const TutorialModal: React.FC<TutorialModalProps> = ({ onClose }) => {
  return (
    <div className="modal-overlay" style={{ zIndex: 1000 }}>
      <div className="modal-content glass-panel" style={{ width: '650px', maxWidth: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <h2 className="modal-title">Floorplanner Tutorial</h2>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Designed & Developed by <strong>Yongkai Zhang</strong>
            </span>
          </div>
          <button className="modal-close-btn" onClick={onClose} style={{ alignSelf: 'flex-start' }}>
            <FiX />
          </button>
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '8px' }}>
          <section style={{ marginBottom: '24px' }}>
            <h3 style={{ color: '#38bdf8', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FiLayers /> Core Concepts
            </h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6' }}>
              <strong>Master IP (Cell):</strong> A template defining the size and name of an IP block. You create these in the left sidebar.<br/>
              <strong>Instance:</strong> An actual copy of a Master IP placed on your top-level ASIC canvas. You can place multiple instances of the same Master IP.
            </p>
          </section>

          <section style={{ marginBottom: '24px' }}>
            <h3 style={{ color: '#38bdf8', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FiMousePointer /> Navigation
            </h3>
            <ul style={{ color: 'var(--text-secondary)', lineHeight: '1.6', paddingLeft: '20px' }}>
              <li><strong>Pan (Move canvas):</strong> Click and drag the middle mouse button (or hold Space + Left click).</li>
              <li><strong>Zoom:</strong> Use your mouse wheel.</li>
            </ul>
          </section>

          <section style={{ marginBottom: '24px' }}>
            <h3 style={{ color: '#38bdf8', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FiDownload /> The Power of SVG Export
            </h3>
            <div style={{ background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.2)', padding: '12px 16px', borderRadius: '6px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
              Our SVG export is <strong>not just an image</strong>. When you click Export SVG, the entire floorplan layout, grid configurations, rulers, and metadata are seamlessly injected and embedded into the SVG file itself. <br/><br/>
              This means you can drop the SVG into your design presentation, and later, simply click <strong>Import SVG</strong> to losslessly restore your complete, editable session right where you left off. It acts as both a visual asset and a project save file!
            </div>
          </section>

          <section>
            <h3 style={{ color: '#38bdf8', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FiCommand /> Keyboard Shortcuts (Native CAD UX)
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', color: 'var(--text-secondary)' }}>
              <div><kbd style={kbdStyle}>n</kbd> Create new Master IP</div>
              <div><kbd style={kbdStyle}>i</kbd> Instantiate an IP (Add to cursor)</div>
              <div><kbd style={kbdStyle}>c</kbd> Copy selected instance</div>
              <div><kbd style={kbdStyle}>q</kbd> Toggle Properties Panel</div>
              <div><kbd style={kbdStyle}>m</kbd> Select Mode (Cancel placement)</div>
              <div><kbd style={kbdStyle}>k</kbd> Ruler (Measure distance)</div>
              <div><kbd style={kbdStyle}>Shift + k</kbd> Clear all rulers</div>
              <div><kbd style={kbdStyle}>o</kbd> Toggle Orthogonal measuring</div>
              <div><kbd style={kbdStyle}>f</kbd> Fit view to screen</div>
              <div><kbd style={kbdStyle}>u</kbd> Undo last action</div>
              <div><kbd style={kbdStyle}>Del</kbd> Delete selected instance</div>
              <div><kbd style={kbdStyle}>Esc</kbd> Cancel current action</div>
            </div>
          </section>
        </div>

        <div className="modal-actions" style={{ marginTop: '16px' }}>
          <button className="btn btn-primary" onClick={onClose}>Got it, Let's go!</button>
        </div>
      </div>
    </div>
  );
};

const kbdStyle: React.CSSProperties = {
  backgroundColor: 'rgba(51, 65, 85, 0.5)',
  border: '1px solid #475569',
  borderRadius: '4px',
  padding: '2px 6px',
  fontFamily: 'monospace',
  fontSize: '12px',
  marginRight: '8px',
  color: '#e2e8f0',
  boxShadow: '0 2px 0 rgba(0,0,0,0.2)'
};
