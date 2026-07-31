import React from 'react';
import { useStore } from '../store/useStore';
import { FiInfo, FiTrash2, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import './PropertiesPanel.css';

const ORIENTATIONS = ['R0', 'R90', 'R180', 'R270', 'MX', 'MY', 'MXR90', 'MYR90'];

export const PropertiesPanel: React.FC = () => {
  const { masterCells, instances, selectedInstanceId, updateInstancePosition, updateInstanceOrientation, deleteInstance, showPropertiesPanel, setShowPropertiesPanel } = useStore();
  
  const selectedInstance = instances.find(inst => inst.id === selectedInstanceId);
  const masterCell = selectedInstance ? masterCells[selectedInstance.cellId] : null;

  return (
    <div className={`properties-wrapper ${!showPropertiesPanel ? 'collapsed' : ''}`}>
      <button 
        className="collapse-toggle right-toggle" 
        onClick={() => setShowPropertiesPanel(!showPropertiesPanel)}
        title={!showPropertiesPanel ? "Expand Properties" : "Collapse Properties"}
      >
        {!showPropertiesPanel ? <FiChevronLeft /> : <FiChevronRight />}
      </button>

      <div className="properties-panel glass-panel">
        {!selectedInstance || !masterCell ? (
          <div className="empty-state">
            <FiInfo size={24} className="empty-icon" />
            <p>Select an instance to view its properties.</p>
          </div>
        ) : (
          <>
            <div className="panel-header">
              <h3 className="section-title">Properties</h3>
            </div>
            
            <div className="prop-section">
              <div className="prop-row">
                <span className="prop-label">Instance</span>
                <span className="prop-value highlight">{selectedInstance.name}</span>
              </div>
              <div className="prop-row">
                <span className="prop-label">Master Cell</span>
                <span className="prop-value">{masterCell.cellName}</span>
              </div>
              <div className="prop-row">
                <span className="prop-label">Library</span>
                <span className="prop-value">{masterCell.libName}</span>
              </div>
              <div className="prop-row">
                <span className="prop-label">Size (um)</span>
                <span className="prop-value">{masterCell.width.toFixed(3)} x {masterCell.height.toFixed(3)}</span>
              </div>
            </div>

            <div className="prop-section">
              <h4 className="sub-title">Transform (Virtuoso)</h4>
              <div className="form-row">
                <div className="form-group">
                  <label className="label">X (um)</label>
                  <input 
                    type="number" 
                    step="any"
                    className="input-field" 
                    value={selectedInstance.x}
                    onChange={e => {
                      const num = parseFloat(e.target.value) || 0;
                      updateInstancePosition(selectedInstance.id, num, selectedInstance.y);
                    }}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Y (um)</label>
                  <input 
                    type="number" 
                    step="any"
                    className="input-field" 
                    value={selectedInstance.y}
                    onChange={e => {
                      const num = parseFloat(e.target.value) || 0;
                      updateInstancePosition(selectedInstance.id, selectedInstance.x, num);
                    }}
                  />
                </div>
              </div>
              <div className="form-group" style={{marginTop: '12px'}}>
                <label className="label">Orientation</label>
                <select 
                  className="input-field" 
                  value={selectedInstance.orientation}
                  onChange={e => updateInstanceOrientation(selectedInstance.id, e.target.value)}
                >
                  {ORIENTATIONS.map(ort => (
                    <option key={ort} value={ort}>{ort}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="prop-section">
              <button className="btn btn-danger" onClick={() => deleteInstance(selectedInstance.id)}>
                <FiTrash2 /> Delete Instance
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
