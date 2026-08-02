import React, { useState, useRef } from 'react';
import { useStore } from '../store/useStore';
import type { Cell, PadSide } from '../store/useStore';
import { FiLayers, FiBox, FiTarget, FiPlus, FiCrosshair, FiSettings, FiTrash2, FiX, FiPaperclip, FiGrid, FiEye, FiEyeOff, FiMove } from 'react-icons/fi';
import './Sidebar.css';
import { formatGridValue } from '../utils/grid';

const PRESET_COLORS = [
  '#2563eb', '#3b82f6', '#60a5fa', '#0ea5e9', '#06b6d4', '#14b8a6',
  '#16a34a', '#22c55e', '#84cc16', '#ca8a04', '#eab308', '#f59e0b',
  '#ea580c', '#f97316', '#dc2626', '#ef4444', '#e11d48', '#ec4899',
  '#c026d3', '#a855f7', '#7c3aed', '#6366f1', '#64748b', '#ffffff',
];

const OUTLINE_STYLES: Array<{ value: NonNullable<Cell['outlineStyle']>; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'none', label: 'None' },
];

export const Sidebar: React.FC = () => {
  const { 
    topWidth, topHeight, topLibName, topCellName, 
    setTopDimensions, setTopNames,
    masterCells, instances, selectedInstanceIds, setSelectedInstance,
    addMasterCell, updateMasterCell, deleteMasterCell, placeInstance, createPadRow, prepareManualPadPlacement,
    pixelArray, startPixelArrayPlacement, setPixelArrayVisible, deletePixelArray,
    showCreateModal, setShowCreateModal, 
    showInstantiateModal, setShowInstantiateModal, 
    setPlacement, leftSidebarPinned, setLeftSidebarPinned, gridSize,
  } = useStore();
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeout = useRef<number | null>(null);
  
  const [instantiateSelection, setInstantiateSelection] = useState('');
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  
  const [newCellName, setNewCellName] = useState('');
  const [newWidth, setNewWidth] = useState('10');
  const [newHeight, setNewHeight] = useState('10');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [newOpacity, setNewOpacity] = useState('50');
  const [newOutlineStyle, setNewOutlineStyle] = useState<NonNullable<Cell['outlineStyle']>>('solid');

  const [showEditTopModal, setShowEditTopModal] = useState(false);
  const [editTopLibName, setEditTopLibName] = useState(topLibName);
  const [editTopCellName, setEditTopCellName] = useState(topCellName);
  const [editTopWidth, setEditTopWidth] = useState(topWidth.toString());
  const [editTopHeight, setEditTopHeight] = useState(topHeight.toString());

  const [showPadModal, setShowPadModal] = useState(false);
  const [padCellName, setPadCellName] = useState('PAD');
  const [padWidth, setPadWidth] = useState('10');
  const [padHeight, setPadHeight] = useState('10');
  const [padCount, setPadCount] = useState('8');
  const [padPitch, setPadPitch] = useState('12');
  const [padSide, setPadSide] = useState<PadSide>('top');
  const [padOffset, setPadOffset] = useState('0');
  const [padColor, setPadColor] = useState('#f59e0b');
  const [padOrientation, setPadOrientation] = useState('R0');
  const [padAutoOrient, setPadAutoOrient] = useState(true);
  const [padPlacementMode, setPadPlacementMode] = useState<'row' | 'manual'>('row');
  const [showPixelArrayModal, setShowPixelArrayModal] = useState(false);
  const [pixelArrayWidth, setPixelArrayWidth] = useState('60');
  const [pixelArrayHeight, setPixelArrayHeight] = useState('60');

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newCellName && newWidth && newHeight) {
      if (editingCellId) {
        updateMasterCell(editingCellId, topLibName, newCellName, parseFloat(newWidth), parseFloat(newHeight), newColor, Number(newOpacity) / 100, newOutlineStyle);
        setEditingCellId(null);
      } else {
        addMasterCell(topLibName, newCellName, parseFloat(newWidth), parseFloat(newHeight), newColor, Number(newOpacity) / 100, newOutlineStyle);
      }
      setShowCreateModal(false);
      setNewCellName('');
    }
  };

  const handlePadSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (padPlacementMode === 'manual') {
        prepareManualPadPlacement({
          libName: topLibName,
          cellName: padCellName,
          width: Number(padWidth),
          height: Number(padHeight),
          color: padColor,
          count: Number(padCount),
          pitch: Number(padPitch),
          orientation: padOrientation,
        });
        setShowPadModal(false);
        return;
      }
      createPadRow({
        libName: topLibName,
        cellName: padCellName,
        width: Number(padWidth),
        height: Number(padHeight),
        color: padColor,
        count: Number(padCount),
        pitch: Number(padPitch),
        side: padSide,
        offset: Number(padOffset),
        orientation: resolvedPadOrientation,
        offsetReference: 'start',
      });
      setShowPadModal(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to create the pad row.');
    }
  };

  const openPixelArrayModal = () => {
    setPixelArrayWidth(String(pixelArray?.width ?? Math.max(gridSize, topWidth * 0.6)));
    setPixelArrayHeight(String(pixelArray?.height ?? Math.max(gridSize, topHeight * 0.6)));
    setShowPixelArrayModal(true);
  };

  const handlePixelArraySubmit = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      startPixelArrayPlacement(Number(pixelArrayWidth), Number(pixelArrayHeight));
      setShowPixelArrayModal(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to configure the pixel array.');
    }
  };

  const openCreateModal = () => {
    setEditingCellId(null);
    setNewCellName('');
    setNewOpacity('50');
    setNewOutlineStyle('solid');
    setShowCreateModal(true);
  };

  const openEditModal = (cell: Cell) => {
    setEditingCellId(cell.id);
    setNewCellName(cell.cellName);
    setNewWidth(cell.width.toString());
    setNewHeight(cell.height.toString());
    setNewColor(cell.color);
    setNewOpacity(String(Math.round((cell.opacity ?? 0.5) * 100)));
    setNewOutlineStyle(cell.outlineStyle ?? 'solid');
    setShowCreateModal(true);
  };

  const fitPadsToEdge = () => {
    const rotated = resolvedPadOrientation === 'R90' || resolvedPadOrientation === 'R270';
    const physicalWidth = rotated ? Number(padHeight) : Number(padWidth);
    const physicalHeight = rotated ? Number(padWidth) : Number(padHeight);
    const along = padSide === 'top' || padSide === 'bottom' ? physicalWidth : physicalHeight;
    const available = padSide === 'top' || padSide === 'bottom' ? topWidth : topHeight;
    const pitch = Number(padPitch);
    if (!Number.isFinite(along) || along <= 0 || !Number.isFinite(pitch) || pitch < along) return;
    setPadCount(String(Math.max(1, Math.floor((available - along) / pitch) + 1)));
    setPadOffset('0');
  };

  const sideOrientation: Record<PadSide, string> = { top: 'R0', right: 'R270', bottom: 'R180', left: 'R90' };
  const resolvedPadOrientation = padPlacementMode === 'row' && padAutoOrient
    ? sideOrientation[padSide]
    : padOrientation;
  const padRotated = resolvedPadOrientation === 'R90' || resolvedPadOrientation === 'R270';
  const padPhysicalWidth = padRotated ? Number(padHeight) : Number(padWidth);
  const padPhysicalHeight = padRotated ? Number(padWidth) : Number(padHeight);
  const padAlong = padSide === 'top' || padSide === 'bottom' ? padPhysicalWidth : padPhysicalHeight;
  const padGap = Number(padPitch) - padAlong;
  const padSpan = Math.max(0, (Number(padCount) - 1) * Number(padPitch) + padAlong);
  const padAvailable = padSide === 'top' || padSide === 'bottom' ? topWidth : topHeight;
  const padStartCoordinate = -padAvailable / 2 + Number(padOffset);
  const padEndCoordinate = padStartCoordinate + padSpan;

  const handleMouseEnter = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => setIsHovered(true), 300);
  };

  const handleMouseLeave = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => setIsHovered(false), 300);
  };

  const isOpen = leftSidebarPinned || isHovered;

  return (
    <>
      <div 
      className={`sidebar-wrapper ${!isOpen ? 'collapsed' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="sidebar glass-panel">
        <div className="sidebar-section">
          <div className="section-header">
            <h3 className="section-title"><FiLayers /> Top Cell</h3>
            <div className="section-actions">
              <button className="icon-btn" onClick={() => {
                setEditTopLibName(topLibName);
                setEditTopCellName(topCellName);
                setEditTopWidth(topWidth.toString());
                setEditTopHeight(topHeight.toString());
                setShowEditTopModal(true);
              }} title="Edit Top Cell">
                <FiSettings />
              </button>
            </div>
          </div>
          <div style={{padding: '0 8px'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px'}}>
              <span className="cell-name">{topCellName}</span>
              <span className="lib-badge">{topLibName}</span>
            </div>
            <div className="size-badge" style={{display: 'inline-block'}}>
              {topWidth.toFixed(1)}x{topHeight.toFixed(1)}
            </div>
          </div>
          <button className="edge-pad-action" type="button" onClick={() => {
            setShowPadModal(true);
          }}>
            <FiGrid />
            <span><strong>Place edge pads</strong><small>Rows or flexible groups with rotation</small></span>
          </button>
          <div className={`pixel-array-card${pixelArray?.visible ? ' active' : ''}`}>
            <button
              className="pixel-array-toggle"
              type="button"
              onClick={() => pixelArray ? setPixelArrayVisible(!pixelArray.visible) : openPixelArrayModal()}
            >
              {pixelArray?.visible ? <FiEyeOff /> : <FiEye />}
              <span>
                <strong>{pixelArray?.visible ? 'Disable Pixel Array' : 'Enable Pixel Array'}</strong>
                <small>{pixelArray ? `${pixelArray.width} × ${pixelArray.height} um · position kept when hidden` : 'Define its size, then click to place'}</small>
              </span>
            </button>
            {pixelArray && (
              <div className="pixel-array-actions">
                <button type="button" onClick={() => {
                  startPixelArrayPlacement(pixelArray.width, pixelArray.height);
                }} title="Move Pixel Array"><FiMove /></button>
                <button type="button" onClick={openPixelArrayModal} title="Edit Pixel Array"><FiSettings /></button>
              </div>
            )}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="section-header">
            <h3 className="section-title"><FiLayers /> Master Cells</h3>
            <button className="icon-btn" onClick={openCreateModal} title="Create IP Master">
              <FiPlus />
            </button>
          </div>
          <ul className="cell-list">
            {Object.values(masterCells).map(cell => (
              <li key={cell.id} className="cell-item static">
                <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                  <div
                    className={`cell-swatch cell-swatch--${cell.outlineStyle ?? 'solid'}`}
                  >
                    <i style={{ backgroundColor: cell.color, opacity: cell.opacity ?? 0.5 }} />
                  </div>
                  <div>
                    <span className="cell-name">{cell.cellName}</span>
                    <span className="lib-badge">{cell.libName}</span>
                  </div>
                </div>
                <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                  <div className="size-badge">
                    {cell.width.toFixed(1)}x{cell.height.toFixed(1)}
                  </div>
                  <button className="icon-btn" onClick={() => openEditModal(cell)} title="Edit IP Definition">
                    <FiSettings />
                  </button>
                  <button className="icon-btn" style={{color: '#3b82f6'}} onClick={() => placeInstance(cell.id)} title="Instantiate">
                    <FiCrosshair />
                  </button>
                </div>
              </li>
            ))}
            {Object.keys(masterCells).length === 0 && (
              <p className="empty-text">No Master Cells defined. Click + to create one.</p>
            )}
          </ul>
        </div>

        <div className="sidebar-section">
          <div className="section-header">
            <h3 className="section-title"><FiBox /> top_asic Instances</h3>
          </div>
          <ul className="instance-list">
            {instances.map(inst => {
              const master = masterCells[inst.cellId];
              if (!master) return null;
              return (
                <li 
                  key={inst.id}
                  className={`instance-item ${selectedInstanceIds.includes(inst.id) ? 'active' : ''}`}
                  onClick={(event) => setSelectedInstance(inst.id, event.shiftKey)}
                >
                  <div className="inst-header">
                    <FiTarget className="inst-icon" />
                    <span className="inst-name">{inst.name}</span>
                    <span className="inst-master">({master.cellName})</span>
                  </div>
                  <div className="inst-pos">
                    {formatGridValue(inst.x, gridSize)} : {formatGridValue(inst.y, gridSize)} [{inst.orientation}]
                  </div>
                </li>
              );
            })}
            {instances.length === 0 && (
              <p className="empty-text">No instances placed yet.</p>
            )}
          </ul>
        </div>
      </div>
      
      <button 
        className={`collapse-toggle left-toggle ${leftSidebarPinned ? 'pinned' : ''}`} 
        onClick={() => setLeftSidebarPinned(!leftSidebarPinned)}
        title={leftSidebarPinned ? "Unpin Sidebar" : "Pin Sidebar"}
      >
        <FiPaperclip style={{ transform: leftSidebarPinned ? 'rotate(-45deg)' : 'none', transition: 'all 0.2s' }} />
      </button>
    </div>

    {showCreateModal && (
          <div className="modal-overlay">
            <div className="modal-content glass-panel master-modal">
              <div className="modal-header">
                <h2 className="modal-title">{editingCellId ? 'Edit Master IP' : 'Create Master IP'}</h2>
                <div style={{display: 'flex', gap: '8px'}}>
                  {editingCellId && (
                    <button 
                      type="button" 
                      className="modal-close-btn" 
                      style={{color: '#ef4444'}} 
                      onClick={() => {
                        if (confirm('Delete this Master IP and all its instances?')) {
                          deleteMasterCell(editingCellId);
                          setShowCreateModal(false);
                          setEditingCellId(null);
                        }
                      }} 
                      title="Delete IP"
                    >
                      <FiTrash2 />
                    </button>
                  )}
                  <button type="button" className="modal-close-btn" onClick={() => { setShowCreateModal(false); setEditingCellId(null); }}>
                    <FiX />
                  </button>
                </div>
              </div>
              <form onSubmit={handleCreateSubmit}>
                <div className="form-group">
                  <label className="label">Library (follows Top Cell)</label>
                  <input className="input-field locked-library" value={topLibName} readOnly aria-label="IP library inherited from top cell" />
                  <small className="field-help">All hierarchy cells are kept in the Top Cell library.</small>
                </div>
                <div className="form-group">
                  <label className="label">Cell Name</label>
                  <input className="input-field" value={newCellName} onChange={e => setNewCellName(e.target.value)} placeholder="e.g. CPU_Core" required autoFocus />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="label">Width (um)</label>
                    <input type="number" step="any" className="input-field" value={newWidth} onChange={e => setNewWidth(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="label">Height (um)</label>
                    <input type="number" step="any" className="input-field" value={newHeight} onChange={e => setNewHeight(e.target.value)} required />
                  </div>
                </div>
                <div className="form-group">
                  <label className="label">IP Color</label>
                  <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap'}}>
                    {PRESET_COLORS.map(c => (
                      <div 
                        key={c}
                        onClick={() => setNewColor(c)}
                        style={{
                          width: '24px', height: '24px', borderRadius: '4px', background: c, cursor: 'pointer',
                          border: newColor === c ? '2px solid #ffffff' : '1px solid #333'
                        }}
                      />
                    ))}
                  </div>
                  <label className="custom-color-picker">
                    <input
                      type="color"
                      value={newColor}
                      onChange={event => setNewColor(event.target.value)}
                      aria-label="Choose a custom IP color"
                    />
                    <span>Custom color</span>
                    <code>{newColor.toUpperCase()}</code>
                  </label>
                </div>
                <div className="appearance-editor">
                  <div className="appearance-preview-wrap">
                    <span className="label">Canvas preview</span>
                    <div
                      className={`appearance-preview appearance-preview--${newOutlineStyle}`}
                      aria-label={`${newOpacity}% opacity with ${newOutlineStyle} outline`}
                    >
                      <i style={{ backgroundColor: newColor, opacity: Number(newOpacity) / 100 }} />
                    </div>
                  </div>
                  <div className="appearance-controls">
                    <div className="appearance-heading">
                      <label className="label" htmlFor="ip-opacity">Fill transparency</label>
                      <strong>{newOpacity}% visible</strong>
                    </div>
                    <input
                      id="ip-opacity"
                      className="opacity-slider"
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={newOpacity}
                      onChange={event => setNewOpacity(event.target.value)}
                    />
                    <label className="label">Outline style</label>
                    <div className="outline-options" role="group" aria-label="IP outline style">
                      {OUTLINE_STYLES.map(option => (
                        <button
                          key={option.value}
                          type="button"
                          className={`outline-option${newOutlineStyle === option.value ? ' active' : ''}`}
                          onClick={() => setNewOutlineStyle(option.value)}
                          aria-pressed={newOutlineStyle === option.value}
                        >
                          <i className={`outline-sample outline-sample--${option.value}`} />
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn" onClick={() => { setShowCreateModal(false); setEditingCellId(null); }}>Cancel</button>
                  <button type="submit" className="btn btn-primary">{editingCellId ? 'Save Changes' : 'Create IP'}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showInstantiateModal && (
          <div className="modal-overlay">
            <div className="modal-content glass-panel">
              <div className="modal-header">
                <h2 className="modal-title">Add Instance</h2>
                <button type="button" className="modal-close-btn" onClick={() => setShowInstantiateModal(false)}>
                  <FiX />
                </button>
              </div>
              <form onSubmit={(e) => {
                e.preventDefault();
                const keys = Object.keys(masterCells);
                const targetId = instantiateSelection || (keys.length > 0 ? keys[0] : null);
                if (targetId) {
                  setPlacement(targetId, 'R0');
                  setShowInstantiateModal(false);
                }
              }}>
                <div className="form-group">
                  <label className="label">Select Master Cell</label>
                  <select 
                    className="input-field" 
                    value={instantiateSelection} 
                    onChange={e => setInstantiateSelection(e.target.value)}
                  >
                    {!instantiateSelection && <option value="" disabled>Select a cell...</option>}
                    {Object.values(masterCells).map(cell => (
                      <option key={cell.id} value={cell.id}>
                        {cell.libName} / {cell.cellName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn" onClick={() => setShowInstantiateModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Attach to Cursor</button>
                </div>
              </form>
            </div>
          </div>
        )}

    {showEditTopModal && (
      <div className="modal-overlay">
        <div className="modal-content glass-panel">
          <div className="modal-header">
            <h2 className="modal-title">Edit Top Cell</h2>
            <button type="button" className="modal-close-btn" onClick={() => setShowEditTopModal(false)}>
              <FiX />
            </button>
          </div>
          <form onSubmit={(e) => {
            e.preventDefault();
            setTopNames(editTopLibName, editTopCellName);
            setTopDimensions(parseFloat(editTopWidth), parseFloat(editTopHeight));
            setShowEditTopModal(false);
          }}>
            <div className="form-group">
              <label className="label">Library Name</label>
              <input className="input-field" value={editTopLibName} onChange={e => setEditTopLibName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="label">Cell Name</label>
              <input className="input-field" value={editTopCellName} onChange={e => setEditTopCellName(e.target.value)} required />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="label">Width (um)</label>
                <input type="number" step="any" className="input-field" value={editTopWidth} onChange={e => setEditTopWidth(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="label">Height (um)</label>
                <input type="number" step="any" className="input-field" value={editTopHeight} onChange={e => setEditTopHeight(e.target.value)} required />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowEditTopModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save Changes</button>
            </div>
          </form>
        </div>
      </div>
    )}

    {showPadModal && (
      <div className="modal-overlay">
        <div className="modal-content glass-panel pad-row-modal">
          <div className="modal-header">
            <div>
              <span className="modal-eyebrow">Perimeter placement</span>
              <h2 className="modal-title">Place Edge Pads</h2>
            </div>
            <button type="button" className="modal-close-btn" onClick={() => setShowPadModal(false)} aria-label="Close pad row tool">
              <FiX />
            </button>
          </div>
          <form onSubmit={handlePadSubmit}>
            <div className="pad-placement-mode" role="group" aria-label="Pad placement method">
              <button type="button" className={padPlacementMode === 'row' ? 'active' : ''} onClick={() => setPadPlacementMode('row')} aria-pressed={padPlacementMode === 'row'}>
                <FiGrid /><span><strong>Automatic row</strong><small>Count and fixed pitch</small></span>
              </button>
              <button type="button" className={padPlacementMode === 'manual' ? 'active' : ''} onClick={() => setPadPlacementMode('manual')} aria-pressed={padPlacementMode === 'manual'}>
                <FiCrosshair /><span><strong>Manual / separated</strong><small>Click flexible pad groups</small></span>
              </button>
            </div>
            <div className="pad-row-guide">
              <span><b>1</b> Define one reusable pad cell</span>
              <span><b>2</b>{padPlacementMode === 'row' ? ' Choose edge, count, pitch, and rotation' : ' Set group count, pitch, and rotation'}</span>
              <span><b>3</b>{padPlacementMode === 'row' ? ' Drag pads around the perimeter later' : ' Click each group; leave any gap between groups'}</span>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="label">Library (follows Top Cell)</label>
                <input className="input-field locked-library" value={topLibName} readOnly aria-label="Pad library inherited from top cell" />
              </div>
              <div className="form-group">
                <label className="label">Pad Cell</label>
                <input className="input-field" value={padCellName} onChange={event => setPadCellName(event.target.value)} required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="label">Pad Width (um)</label>
                <input type="number" min="0" step="any" className="input-field" value={padWidth} onChange={event => setPadWidth(event.target.value)} required />
              </div>
              <div className="form-group">
                <label className="label">Pad Height (um)</label>
                <input type="number" min="0" step="any" className="input-field" value={padHeight} onChange={event => setPadHeight(event.target.value)} required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="label">Orientation (Virtuoso)</label>
                <select className="input-field" value={padPlacementMode === 'row' && padAutoOrient ? resolvedPadOrientation : padOrientation} onChange={event => setPadOrientation(event.target.value)} disabled={padPlacementMode === 'row' && padAutoOrient}>
                  {['R0', 'R90', 'R180', 'R270'].map(orientation => <option key={orientation} value={orientation}>{orientation}</option>)}
                </select>
                {padPlacementMode === 'row' && (
                  <label className="checkbox-label">
                    <input type="checkbox" checked={padAutoOrient} onChange={event => setPadAutoOrient(event.target.checked)} />
                    Auto by edge ({resolvedPadOrientation})
                  </label>
                )}
              </div>
              <div className="form-group pad-fit-hint">
                <span className="label">Placed footprint</span>
                <strong>{Number.isFinite(padPhysicalWidth) ? padPhysicalWidth.toFixed(3) : '—'} × {Number.isFinite(padPhysicalHeight) ? padPhysicalHeight.toFixed(3) : '—'} um</strong>
                <small>{padRotated ? `${resolvedPadOrientation} swaps physical width and height` : `${resolvedPadOrientation} uses defined width and height`}</small>
              </div>
            </div>
            {padPlacementMode === 'row' ? <>
              <div className="form-row">
                <div className="form-group">
                  <div className="field-label-row">
                    <label className="label">Count</label>
                    <button type="button" className="text-action" onClick={fitPadsToEdge}>Fill edge</button>
                  </div>
                  <input type="number" min="1" max="1000" step="1" className="input-field" value={padCount} onChange={event => setPadCount(event.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="label">Pitch, center-to-center (um)</label>
                  <input type="number" min="0" step="any" className="input-field" value={padPitch} onChange={event => setPadPitch(event.target.value)} required />
                </div>
              </div>
              <div className="form-group">
                <label className="label">Choose Top-cell Edge</label>
                <div className="pad-edge-picker" role="group" aria-label="Top-cell pad edge">
                  {(['top', 'right', 'bottom', 'left'] as PadSide[]).map(side => (
                    <button
                      key={side}
                      type="button"
                      className={`pad-edge-option pad-edge-option--${side}${padSide === side ? ' active' : ''}`}
                      onClick={() => setPadSide(side)}
                      aria-pressed={padSide === side}
                    >
                      <i />
                      <span>{side}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <div className="field-label-row">
                    <label className="label">Shift from Top-cell {padSide === 'top' || padSide === 'bottom' ? 'Left Edge' : 'Bottom Edge'} (um)</label>
                    <button type="button" className="text-action" onClick={() => setPadOffset(String((padAvailable - padSpan) / 2))}>Center row</button>
                  </div>
                  <input type="number" step="any" className="input-field" value={padOffset} onChange={event => setPadOffset(event.target.value)} required />
                </div>
                <div className="form-group pad-fit-hint">
                  <span className="label">Resolved canvas coordinates</span>
                  <strong>{Number.isFinite(padStartCoordinate) && Number.isFinite(padEndCoordinate) ? `${padStartCoordinate.toFixed(3)} → ${padEndCoordinate.toFixed(3)} um` : '—'}</strong>
                  <small className={padGap < 0 ? 'error-text' : ''}>
                    {Number.isFinite(padGap) ? (padGap < 0 ? `${Math.abs(padGap).toFixed(3)} um overlap` : `${padSpan.toFixed(3)} um span · ${padGap.toFixed(3)} um pad gap`) : 'Enter valid dimensions'}
                  </small>
                </div>
              </div>
            </> : (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label className="label">Pads per group</label>
                    <input type="number" min="1" max="1000" step="1" className="input-field" value={padCount} onChange={event => setPadCount(event.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="label">Pitch, center-to-center (um)</label>
                    <input type="number" min="0" step="any" className="input-field" value={padPitch} onChange={event => setPadPitch(event.target.value)} required />
                  </div>
                </div>
                <div className="manual-pad-guide">
                  <FiCrosshair />
                  <div><strong>Each click places one group.</strong><span>The preview follows the nearest edge. Click again after any keep-out gap or on another edge; every pad reuses the same Cadence cell. Press Esc when finished.</span></div>
                </div>
              </>
            )}
            <div className="pad-row-options">
              <label className="pad-color-field">
                <input type="color" value={padColor} onChange={event => setPadColor(event.target.value)} />
                <span><strong>Planning color</strong><small>Cadence display colors still come from the technology file.</small></span>
              </label>
              <div className="pad-row-summary">
                <strong>{padPlacementMode === 'row' ? `${Number(padCount) || 0} pads attached to the ${padSide} edge` : `${Number(padCount) || 0} pads per click · ${padPitch || '—'} um pitch`}</strong>
                <span>{padPlacementMode === 'row' ? `Shift starts at the Top Cell’s ${padSide === 'top' || padSide === 'bottom' ? 'left' : 'bottom'} edge · continues toward positive ${padSide === 'top' || padSide === 'bottom' ? 'X' : 'Y'}` : 'Place multiple groups with arbitrary gaps; all instances use one reusable master.'}</span>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowPadModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">{padPlacementMode === 'row' ? <><FiGrid /> Place {Number(padCount) || 0} Pads</> : <><FiCrosshair /> Place Groups on Canvas</>}</button>
            </div>
          </form>
        </div>
      </div>
    )}

    {showPixelArrayModal && (
      <div className="modal-overlay">
        <div className="modal-content glass-panel pixel-array-modal">
          <div className="modal-header">
            <div>
              <span className="modal-eyebrow">Top-cell overlay</span>
              <h2 className="modal-title">{pixelArray ? 'Edit Pixel Array' : 'Enable Pixel Array'}</h2>
            </div>
            <button type="button" className="modal-close-btn" onClick={() => setShowPixelArrayModal(false)} aria-label="Close pixel array setup">
              <FiX />
            </button>
          </div>
          <form onSubmit={handlePixelArraySubmit}>
            <div className="pixel-array-guide">
              <FiGrid />
              <div><strong>Define the active-array region</strong><span>It must be smaller than the {topWidth} × {topHeight} um top cell. The size and final position snap to the {gridSize} um grid.</span></div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="label">Array Width (um)</label>
                <input type="number" min={gridSize} max={topWidth - gridSize} step="any" className="input-field" value={pixelArrayWidth} onChange={event => setPixelArrayWidth(event.target.value)} required autoFocus />
              </div>
              <div className="form-group">
                <label className="label">Array Height (um)</label>
                <input type="number" min={gridSize} max={topHeight - gridSize} step="any" className="input-field" value={pixelArrayHeight} onChange={event => setPixelArrayHeight(event.target.value)} required />
              </div>
            </div>
            <div className="pixel-array-place-note">
              <FiMove />
              <span>After confirming, move the preview over the top cell and click once to place it. You can drag the array later.</span>
            </div>
            <div className="modal-actions pixel-array-modal-actions">
              {pixelArray && (
                <button type="button" className="btn danger-btn" onClick={() => {
                  if (confirm('Remove the pixel array from this floorplan?')) {
                    deletePixelArray();
                    setShowPixelArrayModal(false);
                  }
                }}><FiTrash2 /> Remove</button>
              )}
              <span />
              <button type="button" className="btn" onClick={() => setShowPixelArrayModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary"><FiCrosshair /> {pixelArray ? 'Resize & Relocate' : 'Attach to Cursor'}</button>
            </div>
          </form>
        </div>
      </div>
    )}
    </>
  );
};
