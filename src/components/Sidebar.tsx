import React, { useState, useRef } from 'react';
import { useStore } from '../store/useStore';
import { FiLayers, FiBox, FiTarget, FiPlus, FiPlusSquare, FiEdit2, FiTrash2, FiX, FiPaperclip } from 'react-icons/fi';
import './Sidebar.css';

const PRESET_COLORS = [
  '#3b82f6', '#ef4444', '#f97316', '#eab308', '#22c55e', 
  '#06b6d4', '#8b5cf6', '#d946ef', '#64748b', '#ffffff'
];

export const Sidebar: React.FC = () => {
  const { masterCells, instances, selectedInstanceId, setSelectedInstance, addMasterCell, updateMasterCell, deleteMasterCell, placeInstance, showCreateModal, setShowCreateModal, showInstantiateModal, setShowInstantiateModal, setPlacement, leftSidebarPinned, setLeftSidebarPinned } = useStore();
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeout = useRef<number | null>(null);
  
  const [instantiateSelection, setInstantiateSelection] = useState('');
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  
  const [newLibName, setNewLibName] = useState('custom_lib');
  const [newCellName, setNewCellName] = useState('');
  const [newWidth, setNewWidth] = useState('10');
  const [newHeight, setNewHeight] = useState('10');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newLibName && newCellName && newWidth && newHeight) {
      if (editingCellId) {
        updateMasterCell(editingCellId, newLibName, newCellName, parseFloat(newWidth), parseFloat(newHeight), newColor);
        setEditingCellId(null);
      } else {
        addMasterCell(newLibName, newCellName, parseFloat(newWidth), parseFloat(newHeight), newColor);
      }
      setShowCreateModal(false);
      setNewCellName('');
    }
  };

  const openCreateModal = () => {
    setEditingCellId(null);
    setNewCellName('');
    setShowCreateModal(true);
  };

  const openEditModal = (cell: any) => {
    setEditingCellId(cell.id);
    setNewLibName(cell.libName);
    setNewCellName(cell.cellName);
    setNewWidth(cell.width.toString());
    setNewHeight(cell.height.toString());
    setNewColor(cell.color);
    setShowCreateModal(true);
  };

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
    <div 
      className={`sidebar-wrapper ${!isOpen ? 'collapsed' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="sidebar glass-panel">
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
                  <div style={{width: 12, height: 12, backgroundColor: cell.color, borderRadius: 2}}></div>
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
                    <FiEdit2 />
                  </button>
                  <button className="icon-btn" style={{color: '#3b82f6'}} onClick={() => placeInstance(cell.id)} title="Instantiate">
                    <FiPlusSquare />
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
                  className={`instance-item ${selectedInstanceId === inst.id ? 'active' : ''}`}
                  onClick={() => setSelectedInstance(inst.id)}
                >
                  <div className="inst-header">
                    <FiTarget className="inst-icon" />
                    <span className="inst-name">{inst.name}</span>
                    <span className="inst-master">({master.cellName})</span>
                  </div>
                  <div className="inst-pos">
                    {inst.x.toFixed(3)} : {inst.y.toFixed(3)} [{inst.orientation}]
                  </div>
                </li>
              );
            })}
            {instances.length === 0 && (
              <p className="empty-text">No instances placed yet.</p>
            )}
          </ul>
        </div>

        {showCreateModal && (
          <div className="modal-overlay">
            <div className="modal-content glass-panel">
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
                  <label className="label">Library Name</label>
                  <input className="input-field" value={newLibName} onChange={e => setNewLibName(e.target.value)} required />
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
      </div>
      
      <button 
        className={`collapse-toggle left-toggle ${leftSidebarPinned ? 'pinned' : ''}`} 
        onClick={() => setLeftSidebarPinned(!leftSidebarPinned)}
        title={leftSidebarPinned ? "Unpin Sidebar" : "Pin Sidebar"}
      >
        <FiPaperclip style={{ transform: leftSidebarPinned ? 'rotate(-45deg)' : 'none', transition: 'all 0.2s' }} />
      </button>
    </div>
  );
};
