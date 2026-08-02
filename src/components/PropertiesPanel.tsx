import React from 'react';
import { rotateOrientationByQuarterTurns, useStore } from '../store/useStore';
import { FiInfo, FiTrash2, FiPaperclip, FiRotateCcw, FiRotateCw } from 'react-icons/fi';
import './PropertiesPanel.css';
import { formatGridValue } from '../utils/grid';

const ORIENTATIONS = ['R0', 'R90', 'R180', 'R270', 'MX', 'MY', 'MXR90', 'MYR90'];

export const PropertiesPanel: React.FC = () => {
  const { masterCells, instances, gridSize, selectedInstanceId, selectedInstanceIds, updateInstancePosition, updateInstanceOrientation, deleteSelectedInstances, rightSidebarPinned, setRightSidebarPinned } = useStore();
  const [isHovered, setIsHovered] = React.useState(false);
  const hoverTimeout = React.useRef<number | null>(null);
  
  const selectedInstance = instances.find(inst => inst.id === selectedInstanceId);
  const masterCell = selectedInstance ? masterCells[selectedInstance.cellId] : null;
  const [draftX, setDraftX] = React.useState('0');
  const [draftY, setDraftY] = React.useState('0');

  React.useEffect(() => {
    if (!selectedInstance) return;
    setDraftX(formatGridValue(selectedInstance.x, gridSize));
    setDraftY(formatGridValue(selectedInstance.y, gridSize));
  }, [selectedInstance, gridSize]);

  const commitPosition = (axis: 'x' | 'y') => {
    if (!selectedInstance) return;
    const value = Number.parseFloat(axis === 'x' ? draftX : draftY);
    if (!Number.isFinite(value)) {
      setDraftX(formatGridValue(selectedInstance.x, gridSize));
      setDraftY(formatGridValue(selectedInstance.y, gridSize));
      return;
    }
    updateInstancePosition(
      selectedInstance.id,
      axis === 'x' ? value : selectedInstance.x,
      axis === 'y' ? value : selectedInstance.y,
    );
  };

  const handlePositionKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, axis: 'x' | 'y') => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape' && selectedInstance) {
      if (axis === 'x') setDraftX(formatGridValue(selectedInstance.x, gridSize));
      else setDraftY(formatGridValue(selectedInstance.y, gridSize));
      event.currentTarget.blur();
    }
  };

  const handleMouseEnter = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => setIsHovered(true), 300);
  };

  const handleMouseLeave = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => setIsHovered(false), 300);
  };

  const isOpen = rightSidebarPinned || isHovered;

  return (
    <div 
      className={`properties-wrapper ${!isOpen ? 'collapsed' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button 
        className={`collapse-toggle right-toggle ${rightSidebarPinned ? 'pinned' : ''}`} 
        onClick={() => setRightSidebarPinned(!rightSidebarPinned)}
        title={rightSidebarPinned ? "Unpin Properties" : "Pin Properties"}
      >
        <FiPaperclip style={{ transform: rightSidebarPinned ? 'rotate(45deg)' : 'none', transition: 'all 0.2s' }} />
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
              {selectedInstanceIds.length > 1 && (
                <span className="selection-count">{selectedInstanceIds.length} blocks selected</span>
              )}
            </div>
            
            <div className="prop-section">
              <div className="prop-row">
                <span className="prop-label">{selectedInstanceIds.length > 1 ? 'Primary' : 'Instance'}</span>
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
                    step={gridSize}
                    className="input-field" 
                    value={draftX}
                    onChange={e => setDraftX(e.target.value)}
                    onBlur={() => commitPosition('x')}
                    onKeyDown={event => handlePositionKeyDown(event, 'x')}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Y (um)</label>
                  <input 
                    type="number" 
                    step={gridSize}
                    className="input-field" 
                    value={draftY}
                    onChange={e => setDraftY(e.target.value)}
                    onBlur={() => commitPosition('y')}
                    onKeyDown={event => handlePositionKeyDown(event, 'y')}
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
                <div className="rotation-actions">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => updateInstanceOrientation(selectedInstance.id, rotateOrientationByQuarterTurns(selectedInstance.orientation, -1))}
                    title="Rotate 90° clockwise"
                  >
                    <FiRotateCw /> −90°
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => updateInstanceOrientation(selectedInstance.id, rotateOrientationByQuarterTurns(selectedInstance.orientation, 1))}
                    title="Rotate 90° counter-clockwise"
                  >
                    <FiRotateCcw /> +90°
                  </button>
                </div>
                <p className="rotation-hint">Mouse shortcut: right-click the block to rotate clockwise; Shift-right-click rotates counterclockwise.</p>
              </div>
            </div>

            <div className="prop-section">
              <button className="btn btn-danger" onClick={deleteSelectedInstances}>
                <FiTrash2 /> Delete {selectedInstanceIds.length > 1 ? `${selectedInstanceIds.length} Instances` : 'Instance'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
