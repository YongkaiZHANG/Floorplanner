import React from 'react';
import { rotateOrientationByQuarterTurns, useStore } from '../store/useStore';
import { FiInfo, FiTrash2, FiPaperclip, FiRotateCcw, FiRotateCw, FiEye, FiEyeOff, FiLock, FiUnlock, FiCornerDownRight, FiExternalLink } from 'react-icons/fi';
import './PropertiesPanel.css';
import { formatGridValue } from '../utils/grid';

const ORIENTATIONS = ['R0', 'R90', 'R180', 'R270', 'MX', 'MY', 'MXR90', 'MYR90'];

export const PropertiesPanel: React.FC = () => {
  const {
    masterCells,
    instances,
    cellViews,
    descendIntoInstance,
    openCellView,
    gridSize,
    selectedInstanceId,
    selectedInstanceIds,
    updateInstancePosition,
    renameInstance,
    toggleInstanceLock,
    updateInstanceOrientation,
    deleteSelectedInstances,
    pixelArray,
    pixelArraySelected,
    updatePixelArrayGeometry,
    setPixelArrayVisible,
    deletePixelArray,
    rightSidebarPinned,
    setRightSidebarPinned,
  } = useStore();
  const [isHovered, setIsHovered] = React.useState(false);
  const hoverTimeout = React.useRef<number | null>(null);
  
  const selectedInstance = instances.find(inst => inst.id === selectedInstanceId);
  const masterCell = selectedInstance ? masterCells[selectedInstance.cellId] : null;
  const [draftName, setDraftName] = React.useState('');
  const [draftX, setDraftX] = React.useState('0');
  const [draftY, setDraftY] = React.useState('0');

  const [draftArrayX, setDraftArrayX] = React.useState('0');
  const [draftArrayY, setDraftArrayY] = React.useState('0');
  const [draftArrayW, setDraftArrayW] = React.useState('0');
  const [draftArrayH, setDraftArrayH] = React.useState('0');

  React.useEffect(() => {
    if (!selectedInstance) return;
    setDraftName(selectedInstance.name);
    setDraftX(formatGridValue(selectedInstance.x, gridSize));
    setDraftY(formatGridValue(selectedInstance.y, gridSize));
  }, [selectedInstance, gridSize]);

  React.useEffect(() => {
    if (!pixelArray) return;
    setDraftArrayX(formatGridValue(pixelArray.x, gridSize));
    setDraftArrayY(formatGridValue(pixelArray.y, gridSize));
    setDraftArrayW(formatGridValue(pixelArray.width, gridSize));
    setDraftArrayH(formatGridValue(pixelArray.height, gridSize));
  }, [pixelArray, gridSize]);

  const commitInstanceName = () => {
    if (!selectedInstance) return;
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === selectedInstance.name) {
      setDraftName(selectedInstance.name);
      return;
    }
    try {
      renameInstance(selectedInstance.id, trimmed);
    } catch (error) {
      setDraftName(selectedInstance.name);
      alert(error instanceof Error ? error.message : 'Unable to rename the selected instance.');
    }
  };

  const commitPosition = (axis: 'x' | 'y') => {
    if (!selectedInstance) return;
    const value = Number.parseFloat(axis === 'x' ? draftX : draftY);
    if (!Number.isFinite(value)) {
      setDraftX(formatGridValue(selectedInstance.x, gridSize));
      setDraftY(formatGridValue(selectedInstance.y, gridSize));
      return;
    }
    try {
      updateInstancePosition(
        selectedInstance.id,
        axis === 'x' ? value : selectedInstance.x,
        axis === 'y' ? value : selectedInstance.y,
      );
    } catch (error) {
      setDraftX(formatGridValue(selectedInstance.x, gridSize));
      setDraftY(formatGridValue(selectedInstance.y, gridSize));
      alert(error instanceof Error ? error.message : 'Unable to move the selected instance.');
    }
  };

  const commitPixelArrayField = (field: 'x' | 'y' | 'width' | 'height') => {
    if (!pixelArray) return;
    const raw = field === 'x' ? draftArrayX : field === 'y' ? draftArrayY : field === 'width' ? draftArrayW : draftArrayH;
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) {
      setDraftArrayX(formatGridValue(pixelArray.x, gridSize));
      setDraftArrayY(formatGridValue(pixelArray.y, gridSize));
      setDraftArrayW(formatGridValue(pixelArray.width, gridSize));
      setDraftArrayH(formatGridValue(pixelArray.height, gridSize));
      return;
    }
    try {
      updatePixelArrayGeometry(
        field === 'x' ? value : pixelArray.x,
        field === 'y' ? value : pixelArray.y,
        field === 'width' ? value : pixelArray.width,
        field === 'height' ? value : pixelArray.height,
      );
    } catch (error) {
      setDraftArrayX(formatGridValue(pixelArray.x, gridSize));
      setDraftArrayY(formatGridValue(pixelArray.y, gridSize));
      setDraftArrayW(formatGridValue(pixelArray.width, gridSize));
      setDraftArrayH(formatGridValue(pixelArray.height, gridSize));
      alert(error instanceof Error ? error.message : 'Unable to update the pixel array.');
    }
  };

  const applyOrientation = (orientation: string) => {
    if (!selectedInstance) return;
    try {
      updateInstanceOrientation(selectedInstance.id, orientation);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to orient the selected instance.');
    }
  };

  React.useEffect(() => () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
  }, []);

  const handlePositionKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, axis: 'x' | 'y') => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape' && selectedInstance) {
      if (axis === 'x') setDraftX(formatGridValue(selectedInstance.x, gridSize));
      else setDraftY(formatGridValue(selectedInstance.y, gridSize));
      event.currentTarget.blur();
    }
  };

  const handlePixelArrayKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, field: 'x' | 'y' | 'width' | 'height') => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape' && pixelArray) {
      if (field === 'x') setDraftArrayX(formatGridValue(pixelArray.x, gridSize));
      else if (field === 'y') setDraftArrayY(formatGridValue(pixelArray.y, gridSize));
      else if (field === 'width') setDraftArrayW(formatGridValue(pixelArray.width, gridSize));
      else setDraftArrayH(formatGridValue(pixelArray.height, gridSize));
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
  const showingPixelArray = !selectedInstance && pixelArraySelected && Boolean(pixelArray);

  return (
    <div 
      className={`properties-wrapper ${!isOpen ? 'collapsed' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button 
        className={`collapse-toggle right-toggle ${rightSidebarPinned ? 'pinned' : ''}`} 
        onClick={() => setRightSidebarPinned(!rightSidebarPinned)}
        title={rightSidebarPinned ? 'Unpin Properties' : 'Pin Properties'}
      >
        <FiPaperclip style={{ transform: rightSidebarPinned ? 'rotate(45deg)' : 'none', transition: 'all 0.2s' }} />
      </button>

      <div className="properties-panel glass-panel">
        {showingPixelArray && pixelArray ? (
          <>
            <div className="panel-header">
              <h3 className="section-title">Pixel Array</h3>
              <span className="selection-count">Active-array overlay</span>
            </div>

            <div className="prop-section">
              <div className="prop-row">
                <span className="prop-label">Center (um)</span>
                <span className="prop-value">
                  {formatGridValue(pixelArray.x + pixelArray.width / 2, gridSize)}, {formatGridValue(pixelArray.y + pixelArray.height / 2, gridSize)}
                </span>
              </div>
              <div className="prop-row">
                <span className="prop-label">Area</span>
                <span className="prop-value">
                  {(pixelArray.width * pixelArray.height).toFixed(2)} um²
                </span>
              </div>
            </div>

            <div className="prop-section">
              <h4 className="sub-title">Geometry (Bottom-Left Origin)</h4>
              <div className="form-row">
                <div className="form-group">
                  <label className="label">X (um)</label>
                  <input
                    type="number"
                    step={gridSize}
                    className="input-field"
                    value={draftArrayX}
                    onChange={e => setDraftArrayX(e.target.value)}
                    onBlur={() => commitPixelArrayField('x')}
                    onKeyDown={event => handlePixelArrayKeyDown(event, 'x')}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Y (um)</label>
                  <input
                    type="number"
                    step={gridSize}
                    className="input-field"
                    value={draftArrayY}
                    onChange={e => setDraftArrayY(e.target.value)}
                    onBlur={() => commitPixelArrayField('y')}
                    onKeyDown={event => handlePixelArrayKeyDown(event, 'y')}
                  />
                </div>
              </div>
              <div className="form-row" style={{ marginTop: '10px' }}>
                <div className="form-group">
                  <label className="label">Width (um)</label>
                  <input
                    type="number"
                    min={gridSize}
                    step={gridSize}
                    className="input-field"
                    value={draftArrayW}
                    onChange={e => setDraftArrayW(e.target.value)}
                    onBlur={() => commitPixelArrayField('width')}
                    onKeyDown={event => handlePixelArrayKeyDown(event, 'width')}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Height (um)</label>
                  <input
                    type="number"
                    min={gridSize}
                    step={gridSize}
                    className="input-field"
                    value={draftArrayH}
                    onChange={e => setDraftArrayH(e.target.value)}
                    onBlur={() => commitPixelArrayField('height')}
                    onKeyDown={event => handlePixelArrayKeyDown(event, 'height')}
                  />
                </div>
              </div>
            </div>

            <div className="prop-section prop-actions-stack">
              <button
                className="btn"
                type="button"
                onClick={() => setPixelArrayVisible(!pixelArray.visible)}
              >
                {pixelArray.visible ? <><FiEyeOff /> Hide Pixel Array</> : <><FiEye /> Show Pixel Array</>}
              </button>
              <button
                className="btn btn-danger"
                type="button"
                onClick={() => {
                  if (confirm('Remove the pixel array from this floorplan?')) deletePixelArray();
                }}
              >
                <FiTrash2 /> Delete Pixel Array
              </button>
            </div>
          </>
        ) : !selectedInstance || !masterCell ? (
          <div className="empty-state">
            <FiInfo size={24} className="empty-icon" />
            <p>Select an instance or the pixel array to view its properties.</p>
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
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="label">{selectedInstanceIds.length > 1 ? 'Primary Instance Name' : 'Instance Name'}</label>
                <input
                  type="text"
                  className="input-field"
                  value={draftName}
                  onChange={e => setDraftName(e.target.value)}
                  onBlur={commitInstanceName}
                  onKeyDown={event => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') {
                      setDraftName(selectedInstance.name);
                      event.currentTarget.blur();
                    }
                  }}
                  aria-label="Instance name"
                />
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
              {masterCell.kind === 'pad' && (
                <div className="prop-row">
                  <span className="prop-label">Behavior</span>
                  <span className="prop-value pad-badge">Edge-bound pad</span>
                </div>
              )}
              <div className="hier-actions-stack">
                <button
                  type="button"
                  className="btn descend-cell-btn"
                  onClick={() => descendIntoInstance(selectedInstance.id)}
                  title={`Descend Edit into ${masterCell.libName}/${masterCell.cellName}/layout (X)`}
                >
                  <FiCornerDownRight />
                  <span>
                    Descend Edit (X)
                    {(cellViews[masterCell.id]?.instances.length ?? 0) > 0
                      ? ` · ${cellViews[masterCell.id].instances.length}`
                      : ''}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn new-window-btn"
                  onClick={() => openCellView(masterCell.id)}
                  title={`Open ${masterCell.libName}/${masterCell.cellName}/layout tab in the top cellview bar`}
                >
                  <FiExternalLink />
                  <span>Open Cellview Tab</span>
                </button>
              </div>
            </div>

            <div className="prop-section">
              <h4 className="sub-title">Transform (Virtuoso)</h4>
              {selectedInstance.locked && (
                <div className="locked-banner">
                  Locked — unlock (L) to move, rotate, align, or delete this block.
                </div>
              )}
              <div className="form-row">
                <div className="form-group">
                  <label className="label">X (um)</label>
                  <input 
                    type="number" 
                    step={gridSize}
                    className="input-field" 
                    value={draftX}
                    disabled={Boolean(selectedInstance.locked)}
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
                    disabled={Boolean(selectedInstance.locked)}
                    onChange={e => setDraftY(e.target.value)}
                    onBlur={() => commitPosition('y')}
                    onKeyDown={event => handlePositionKeyDown(event, 'y')}
                  />
                </div>
              </div>
              {masterCell.kind === 'pad' && (
                <div className="pad-edge-note">
                  <strong>Always attached to the perimeter</strong>
                  <span>Drag this pad along the boundary or toward another side. Rotation uses its transformed footprint and keeps it attached.</span>
                </div>
              )}
              <div className="form-group transform-orientation">
                <label className="label">Orientation</label>
                <select
                  className="input-field"
                  value={selectedInstance.orientation}
                  disabled={Boolean(selectedInstance.locked)}
                  onChange={e => applyOrientation(e.target.value)}
                >
                  {ORIENTATIONS.map(ort => (
                    <option key={ort} value={ort}>{ort}</option>
                  ))}
                </select>
                <div className="rotation-actions">
                  <button
                    className="btn"
                    type="button"
                    disabled={Boolean(selectedInstance.locked)}
                    onClick={() => applyOrientation(rotateOrientationByQuarterTurns(selectedInstance.orientation, -1))}
                    title="Rotate 90° clockwise"
                  >
                    <FiRotateCw /> −90°
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={Boolean(selectedInstance.locked)}
                    onClick={() => applyOrientation(rotateOrientationByQuarterTurns(selectedInstance.orientation, 1))}
                    title="Rotate 90° counter-clockwise"
                  >
                    <FiRotateCcw /> +90°
                  </button>
                </div>
                <p className="rotation-hint">Mouse shortcut: right-click the block to rotate clockwise; Shift-right-click rotates counterclockwise.</p>
              </div>
            </div>

            <div className="prop-section">
              <button
                className={`btn lock-toggle-btn${selectedInstance.locked ? ' is-locked' : ''}`}
                type="button"
                onClick={() => toggleInstanceLock(selectedInstanceIds.length > 0 ? selectedInstanceIds : [selectedInstance.id])}
                title="Lock or unlock selection (L)"
              >
                {selectedInstance.locked ? <><FiUnlock /> Unlock {selectedInstanceIds.length > 1 ? 'Selection' : 'Instance'}</> : <><FiLock /> Lock {selectedInstanceIds.length > 1 ? 'Selection' : 'Instance'}</>}
              </button>
              <button className="btn btn-danger" disabled={Boolean(selectedInstance.locked && selectedInstanceIds.length === 1)} onClick={deleteSelectedInstances}>
                <FiTrash2 /> Delete {selectedInstanceIds.length > 1 ? `${selectedInstanceIds.length} Instances` : 'Instance'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
