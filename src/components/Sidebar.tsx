import React, { useEffect, useMemo, useState, useRef } from 'react';
import { rotateOrientationByQuarterTurns, useStore } from '../store/useStore';
import type { Cell, PadSide, PendingInstanceArray } from '../store/useStore';
import { FiLayers, FiBox, FiTarget, FiPlus, FiCrosshair, FiSettings, FiTrash2, FiX, FiPaperclip, FiGrid, FiEye, FiEyeOff, FiMove, FiLock, FiSearch, FiEdit3, FiArrowUpLeft, FiFolder, FiFolderPlus, FiRotateCw, FiEdit2, FiChevronDown, FiChevronRight, FiArrowDownCircle, FiColumns } from 'react-icons/fi';
import './Sidebar.css';
import { formatGridValue } from '../utils/grid';
import { wouldCreateHierarchyCycle } from '../utils/hierarchy';

const ORIENTATION_OPTIONS = ['R0', 'R90', 'R180', 'R270', 'MX', 'MY', 'MXR90', 'MYR90'] as const;

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
    topWidth, topHeight, topLibName, topCellName, padInset, libraries,
    setTopConfig, setPadInset,
    masterCells, instances, cellViews, activeCellId, rootView,
    createLibrary, renameLibrary, deleteLibrary, moveCellToLibrary, moveAllCellsToLibrary,
    openCellView, openCellViewInNewWindow, descendIntoInstance,
    selectedInstanceIds, setSelectedInstance,
    addMasterCell, updateMasterCell, deleteMasterCell, createPadRow, prepareManualPadPlacement,
    pixelArray, startPixelArrayPlacement, setPixelArrayVisible, deletePixelArray,
    showCreateModal, setShowCreateModal, 
    showInstantiateModal, setShowInstantiateModal, 
    setPlacement, leftSidebarPinned, setLeftSidebarPinned, gridSize,
  } = useStore();
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeout = useRef<number | null>(null);
  
  const [collapsedLibs, setCollapsedLibs] = useState<Record<string, boolean>>({});
  const [showNewLibModal, setShowNewLibModal] = useState(false);
  const [newLibraryDraft, setNewLibraryDraft] = useState('');
  const [moveAllIntoNewLib, setMoveAllIntoNewLib] = useState(false);
  const [draggedCellId, setDraggedCellId] = useState<string | null>(null);
  const [dragOverLib, setDragOverLib] = useState<string | null>(null);

  // Virtuoso Create Instance form state
  const [instLibFilter, setInstLibFilter] = useState<string>('ALL');
  const [instantiateSelection, setInstantiateSelection] = useState('');
  const [instNamePrefix, setInstNamePrefix] = useState('');
  const [instOrientation, setInstOrientation] = useState('R0');
  const [instRows, setInstRows] = useState('1');
  const [instCols, setInstCols] = useState('1');
  const [instDeltaX, setInstDeltaX] = useState('20');
  const [instDeltaY, setInstDeltaY] = useState('20');

  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const [newLibName, setNewLibName] = useState(topLibName);
  const [newCellName, setNewCellName] = useState('');
  const [newWidth, setNewWidth] = useState('10');
  const [newHeight, setNewHeight] = useState('10');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [newOpacity, setNewOpacity] = useState('50');
  const [newOutlineStyle, setNewOutlineStyle] = useState<NonNullable<Cell['outlineStyle']>>('solid');
  const [openCellAfterCreate, setOpenCellAfterCreate] = useState(false);

  const [showEditTopModal, setShowEditTopModal] = useState(false);
  const [editTopLibName, setEditTopLibName] = useState(topLibName);
  const [editTopCellName, setEditTopCellName] = useState(topCellName);
  const [editTopWidth, setEditTopWidth] = useState(topWidth.toString());
  const [editTopHeight, setEditTopHeight] = useState(topHeight.toString());
  const [editPadInset, setEditPadInset] = useState(padInset.toString());

  const [showPadModal, setShowPadModal] = useState(false);
  const [padLibName, setPadLibName] = useState(topLibName);
  const [padCellName, setPadCellName] = useState('PAD');
  const [padWidth, setPadWidth] = useState('10');
  const [padHeight, setPadHeight] = useState('10');
  const [padCount, setPadCount] = useState('8');
  const [padPitch, setPadPitch] = useState('12');
  const [padSide, setPadSide] = useState<PadSide>('top');
  const [padOffset, setPadOffset] = useState('0');
  const [padInsetDraft, setPadInsetDraft] = useState(padInset.toString());
  const [padColor, setPadColor] = useState('#f59e0b');
  const [padOrientation, setPadOrientation] = useState('R0');
  const [padAutoOrient, setPadAutoOrient] = useState(true);
  const [padPlacementMode, setPadPlacementMode] = useState<'row' | 'manual'>('row');
  const [showPixelArrayModal, setShowPixelArrayModal] = useState(false);
  const [pixelArrayWidth, setPixelArrayWidth] = useState('60');
  const [pixelArrayHeight, setPixelArrayHeight] = useState('60');
  const [instanceQuery, setInstanceQuery] = useState('');
  const [instanceFilter, setInstanceFilter] = useState<'all' | 'ip' | 'pad'>('all');

  const rootLibName = rootView?.topLibName ?? topLibName;
  const rootCellName = rootView?.topCellName ?? topCellName;
  const rootWidth = rootView?.topWidth ?? topWidth;
  const rootHeight = rootView?.topHeight ?? topHeight;

  const availableLibraries = useMemo(() => {
    const libs = new Set<string>(libraries);
    libs.add(topLibName);
    libs.add(rootLibName);
    for (const cell of Object.values(masterCells)) {
      if (cell.libName.trim()) libs.add(cell.libName.trim());
    }
    return [...libs].sort((a, b) => a.localeCompare(b));
  }, [libraries, topLibName, rootLibName, masterCells]);

  const effectiveCellViews = useMemo(() => {
    if (!activeCellId) return cellViews;
    return {
      ...cellViews,
      [activeCellId]: {
        instances,
        rulers: [],
        ...(pixelArray ? { pixelArray } : {}),
        ...(padInset > 0 ? { padInset } : {}),
      },
    };
  }, [activeCellId, cellViews, instances, pixelArray, padInset]);

  const eligibleInstantiateCells = useMemo(() => (
    Object.values(masterCells)
      .filter(cell => !wouldCreateHierarchyCycle(activeCellId, cell.id, effectiveCellViews))
      .filter(cell => instLibFilter === 'ALL' || cell.libName === instLibFilter)
      .sort((a, b) => a.libName.localeCompare(b.libName) || a.cellName.localeCompare(b.cellName))
  ), [masterCells, activeCellId, effectiveCellViews, instLibFilter]);

  const cellsByLibrary = useMemo(() => {
    const grouped = new Map<string, Cell[]>();
    for (const lib of availableLibraries) {
      grouped.set(lib, []);
    }
    for (const cell of Object.values(masterCells)) {
      const list = grouped.get(cell.libName) ?? [];
      list.push(cell);
      grouped.set(cell.libName, list);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => a.cellName.localeCompare(b.cellName));
    }
    return grouped;
  }, [availableLibraries, masterCells]);

  const toggleLibExpanded = (lib: string) => {
    setCollapsedLibs(prev => ({ ...prev, [lib]: !prev[lib] }));
  };

  const handleCreateLibrarySubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = newLibraryDraft.trim();
    if (!trimmed) {
      alert('Enter a valid library name.');
      return;
    }
    try {
      createLibrary(trimmed, moveAllIntoNewLib);
      setCollapsedLibs(prev => ({ ...prev, [trimmed]: false }));
      setNewLibName(trimmed);
      setNewLibraryDraft('');
      setMoveAllIntoNewLib(false);
      setShowNewLibModal(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to create library.');
    }
  };

  const handleMoveAllCellsToLib = (targetLib: string) => {
    const totalProjectCells = Object.keys(masterCells).length + 1;
    if (!confirm(`Move all ${totalProjectCells} cells into library "${targetLib}"?`)) return;
    try {
      moveAllCellsToLibrary(targetLib);
      setCollapsedLibs(prev => ({ ...prev, [targetLib]: false }));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to move cells into that library.');
    }
  };

  const handleDropCellOnLib = (targetLib: string, event: React.DragEvent) => {
    event.preventDefault();
    setDragOverLib(null);
    const payload = event.dataTransfer.getData('text/plain') || draggedCellId;
    setDraggedCellId(null);
    if (!payload) return;
    try {
      moveCellToLibrary(payload === '__TOP__' ? null : payload, targetLib);
      setCollapsedLibs(prev => ({ ...prev, [targetLib]: false }));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to move cell into that library.');
    }
  };

  const handleRenameLibrary = (lib: string) => {
    const next = prompt(`Rename Virtuoso library "${lib}" to:`, lib);
    if (!next || next.trim() === lib) return;
    try {
      renameLibrary(lib, next.trim());
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to rename library.');
    }
  };

  const handleDeleteLibrary = (lib: string) => {
    if (!confirm(`Delete empty library "${lib}"?`)) return;
    try {
      deleteLibrary(lib);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to delete library.');
    }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const width = Number.parseFloat(newWidth);
    const height = Number.parseFloat(newHeight);
    const resolvedLib = newLibName.trim() || topLibName;
    if (!resolvedLib || !newCellName.trim() || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      alert('Enter a valid library name, cell name, and positive width and height.');
      return;
    }
    try {
      if (editingCellId) {
        updateMasterCell(editingCellId, resolvedLib, newCellName, width, height, newColor, Number(newOpacity) / 100, newOutlineStyle);
        setEditingCellId(null);
      } else {
        addMasterCell(resolvedLib, newCellName, width, height, newColor, Number(newOpacity) / 100, newOutlineStyle, openCellAfterCreate);
        setCollapsedLibs(prev => ({ ...prev, [resolvedLib]: false }));
      }
      setShowCreateModal(false);
      setNewCellName('');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to save the Cell View definition.');
    }
  };

  const handlePadSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const requestedInset = Number(padInsetDraft);
      if (!Number.isFinite(requestedInset) || requestedInset < 0) {
        throw new RangeError('Pad inset must be a finite number greater than or equal to zero.');
      }
      if (Math.abs(requestedInset - padInset) > 1e-9) {
        setPadInset(requestedInset);
      }
      const resolvedPadLib = padLibName.trim() || topLibName;
      if (padPlacementMode === 'manual') {
        prepareManualPadPlacement({
          libName: resolvedPadLib,
          cellName: padCellName,
          width: Number(padWidth),
          height: Number(padHeight),
          color: padColor,
          count: Number(padCount),
          pitch: Number(padPitch),
        });
        setShowPadModal(false);
        return;
      }
      createPadRow({
        libName: resolvedPadLib,
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

  const openCreateModal = (presetLib?: string) => {
    setEditingCellId(null);
    setNewLibName(presetLib ?? topLibName);
    setNewCellName('');
    setNewOpacity('50');
    setNewOutlineStyle('solid');
    setOpenCellAfterCreate(false);
    setShowCreateModal(true);
  };

  const openEditModal = (cell: Cell) => {
    setEditingCellId(cell.id);
    setNewLibName(cell.libName);
    setNewCellName(cell.cellName);
    setNewWidth(cell.width.toString());
    setNewHeight(cell.height.toString());
    setNewColor(cell.color);
    setNewOpacity(String(Math.round((cell.opacity ?? 0.5) * 100)));
    setNewOutlineStyle(cell.outlineStyle ?? 'solid');
    setOpenCellAfterCreate(false);
    setShowCreateModal(true);
  };

  const handleStartPlacement = (cellId: string, orientation = 'R0', arrayConfig: PendingInstanceArray | null = null) => {
    try {
      setPlacement(cellId, orientation, arrayConfig);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to instantiate this cell in the active view.');
    }
  };

  const handleInstantiateSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const target = eligibleInstantiateCells.find(cell => cell.id === instantiateSelection) ?? eligibleInstantiateCells[0];
    if (!target) {
      alert('No eligible cell is available to instantiate in the current cell view.');
      return;
    }
    const rows = Math.max(1, Math.floor(Number(instRows) || 1));
    const cols = Math.max(1, Math.floor(Number(instCols) || 1));
    const deltaX = Number(instDeltaX);
    const deltaY = Number(instDeltaY);
    if ((rows > 1 || cols > 1) && (!Number.isFinite(deltaX) || !Number.isFinite(deltaY))) {
      alert('Enter finite ΔX and ΔY pitch values for the mosaic array.');
      return;
    }
    const hasCustomArray = rows > 1 || cols > 1 || instNamePrefix.trim().length > 0;
    const arrayConfig: PendingInstanceArray | null = hasCustomArray
      ? {
          namePrefix: instNamePrefix.trim() || undefined,
          rows,
          cols,
          deltaX: Number.isFinite(deltaX) ? deltaX : target.width,
          deltaY: Number.isFinite(deltaY) ? deltaY : target.height,
        }
      : null;
    handleStartPlacement(target.id, instOrientation, arrayConfig);
    setShowInstantiateModal(false);
  };

  const parsedPadInset = Number.isFinite(Number(padInsetDraft)) && Number(padInsetDraft) >= 0 ? Number(padInsetDraft) : 0;

  const fitPadsToEdge = () => {
    const rotated = resolvedPadOrientation === 'R90' || resolvedPadOrientation === 'R270';
    const physicalWidth = rotated ? Number(padHeight) : Number(padWidth);
    const physicalHeight = rotated ? Number(padWidth) : Number(padHeight);
    const along = padSide === 'top' || padSide === 'bottom' ? physicalWidth : physicalHeight;
    const available = (padSide === 'top' || padSide === 'bottom' ? topWidth : topHeight) - parsedPadInset * 2;
    const pitch = Number(padPitch);
    if (!Number.isFinite(along) || along <= 0 || !Number.isFinite(pitch) || pitch < along || available < along) return;
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
  const padAvailable = Math.max(0, (padSide === 'top' || padSide === 'bottom' ? topWidth : topHeight) - parsedPadInset * 2);
  const padStartCoordinate = -padAvailable / 2 + Number(padOffset);
  const padEndCoordinate = padStartCoordinate + padSpan;

  useEffect(() => {
    if (showCreateModal && !editingCellId && !newLibName.trim()) {
      setNewLibName(topLibName);
    }
  }, [showCreateModal, editingCellId, newLibName, topLibName]);

  useEffect(() => {
    if (!showInstantiateModal) return;
    setInstRows('1');
    setInstCols('1');
    setInstNamePrefix('');
    setInstOrientation('R0');
    const first = eligibleInstantiateCells[0];
    if (first && !eligibleInstantiateCells.some(c => c.id === instantiateSelection)) {
      setInstantiateSelection(first.id);
      setInstDeltaX(String(first.width));
      setInstDeltaY(String(first.height));
    }
  }, [showInstantiateModal, eligibleInstantiateCells, instantiateSelection]);

  useEffect(() => () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
  }, []);

  useEffect(() => {
    const closeModalsOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showNewLibModal) {
        setShowNewLibModal(false);
      } else if (showCreateModal) {
        setShowCreateModal(false);
        setEditingCellId(null);
      } else if (showInstantiateModal) {
        setShowInstantiateModal(false);
      } else if (showEditTopModal) {
        setShowEditTopModal(false);
      } else if (showPadModal) {
        setShowPadModal(false);
      } else if (showPixelArrayModal) {
        setShowPixelArrayModal(false);
      }
    };
    window.addEventListener('keydown', closeModalsOnEscape);
    return () => window.removeEventListener('keydown', closeModalsOnEscape);
  }, [showNewLibModal, showCreateModal, showInstantiateModal, showEditTopModal, showPadModal, showPixelArrayModal, setShowCreateModal, setShowInstantiateModal]);

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
            <h3 className="section-title"><FiFolder /> Library Manager</h3>
            <div className="section-actions">
              <button
                className="icon-btn"
                type="button"
                onClick={() => {
                  setNewLibraryDraft('');
                  setMoveAllIntoNewLib(false);
                  setShowNewLibModal(true);
                }}
                title="New Library (File → New → Library)"
              >
                <FiFolderPlus />
              </button>
              <button className="icon-btn" type="button" onClick={() => openCreateModal()} title="New Cell View (N)">
                <FiPlus />
              </button>
            </div>
          </div>

          <div className="virtuoso-lib-tree" role="tree" aria-label="Virtuoso Libraries and Cells">
            {availableLibraries.map(lib => {
              const libCells = cellsByLibrary.get(lib) ?? [];
              const hasTopCell = rootLibName === lib;
              const totalCells = libCells.length + (hasTopCell ? 1 : 0);
              const totalProjectCells = Object.keys(masterCells).length + 1;
              const isCollapsed = Boolean(collapsedLibs[lib]);
              const isDropTarget = dragOverLib === lib;
              return (
                <div
                  key={lib}
                  className={`virtuoso-lib-folder${isDropTarget ? ' virtuoso-lib-folder--drop-target' : ''}`}
                  role="treeitem"
                  aria-expanded={!isCollapsed}
                  onDragOver={event => {
                    event.preventDefault();
                    if (dragOverLib !== lib) setDragOverLib(lib);
                  }}
                  onDragLeave={event => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setDragOverLib(current => (current === lib ? null : current));
                    }
                  }}
                  onDrop={event => handleDropCellOnLib(lib, event)}
                >
                  <div className="virtuoso-lib-folder__header">
                    <button
                      type="button"
                      className="virtuoso-lib-folder__toggle"
                      onClick={() => toggleLibExpanded(lib)}
                      title={`${isCollapsed ? 'Expand' : 'Collapse'} library ${lib} · drop any cell here to move it`}
                    >
                      {isCollapsed ? <FiChevronRight /> : <FiChevronDown />}
                      <FiFolder className="virtuoso-lib-folder__icon" />
                      <span className="virtuoso-lib-folder__name" title={lib}>{lib}</span>
                      <span className="virtuoso-lib-folder__count">{totalCells}</span>
                    </button>
                    <div className="virtuoso-lib-folder__actions">
                      {totalCells < totalProjectCells && (
                        <button
                          type="button"
                          className="lib-mini-btn"
                          onClick={() => handleMoveAllCellsToLib(lib)}
                          title={`Move all existing cells into ${lib}`}
                        >
                          <FiArrowDownCircle />
                        </button>
                      )}
                      <button
                        type="button"
                        className="lib-mini-btn"
                        onClick={() => openCreateModal(lib)}
                        title={`New Cell View inside ${lib}`}
                      >
                        <FiPlus />
                      </button>
                      <button
                        type="button"
                        className="lib-mini-btn"
                        onClick={() => handleRenameLibrary(lib)}
                        title={`Rename library ${lib}`}
                      >
                        <FiEdit2 />
                      </button>
                      {totalCells === 0 && (
                        <button
                          type="button"
                          className="lib-mini-btn lib-mini-btn--danger"
                          onClick={() => handleDeleteLibrary(lib)}
                          title={`Delete empty library ${lib}`}
                        >
                          <FiTrash2 />
                        </button>
                      )}
                    </div>
                  </div>

                  {!isCollapsed && (
                    <ul className="virtuoso-lib-cells" role="group">
                      {hasTopCell && (
                        <li
                          className={`cell-item cell-item--tree static${activeCellId === null ? ' cell-item--open' : ''}`}
                          draggable
                          onDragStart={event => {
                            setDraggedCellId('__TOP__');
                            event.dataTransfer.setData('text/plain', '__TOP__');
                            event.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragEnd={() => {
                            setDraggedCellId(null);
                            setDragOverLib(null);
                          }}
                          onDoubleClick={() => openCellView(null)}
                          title={`Double-click to open · Drag onto another library to move ${rootCellName}`}
                        >
                          <div className="cell-item__info">
                            <div className="cell-swatch cell-swatch--dashed">
                              <i style={{ backgroundColor: '#2997ff', opacity: 0.7 }} />
                            </div>
                            <div className="cell-item__text">
                              <div className="cell-item__title-row">
                                <span className="cell-name" title={`${rootLibName}/${rootCellName}`}>{rootCellName}</span>
                                <span className="top-pill">TOP</span>
                              </div>
                              <div className="cell-item__meta">
                                <span className="size-badge">{rootWidth.toFixed(1)}×{rootHeight.toFixed(1)} µm</span>
                              </div>
                            </div>
                          </div>
                          <div className="cell-item__actions">
                            <button
                              className={`icon-btn${activeCellId === null ? ' icon-btn--active' : ''}`}
                              onClick={() => openCellView(null)}
                              title={`Open ${rootCellName} layout view`}
                            >
                              <FiEdit3 />
                            </button>
                            <button
                              className="icon-btn"
                              onClick={() => openCellViewInNewWindow(null)}
                              title={`Open ${rootCellName} in separate split window`}
                            >
                              <FiColumns />
                            </button>
                            <button
                              className="icon-btn"
                              onClick={() => {
                                if (activeCellId !== null) openCellView(null);
                                setEditTopLibName(rootLibName);
                                setEditTopCellName(rootCellName);
                                setEditTopWidth(rootWidth.toString());
                                setEditTopHeight(rootHeight.toString());
                                setEditPadInset((rootView?.padInset ?? padInset).toString());
                                setShowEditTopModal(true);
                              }}
                              title="Top Cell Properties"
                            >
                              <FiSettings />
                            </button>
                          </div>
                        </li>
                      )}
                      {libCells.map(cell => {
                        const isOpenView = activeCellId === cell.id;
                        const subCount = isOpenView
                          ? instances.length
                          : (cellViews[cell.id]?.instances.length ?? 0);
                        const blocksCycle = wouldCreateHierarchyCycle(activeCellId, cell.id, effectiveCellViews);
                        return (
                          <li
                            key={cell.id}
                            className={`cell-item cell-item--tree static${isOpenView ? ' cell-item--open' : ''}`}
                            draggable
                            onDragStart={event => {
                              setDraggedCellId(cell.id);
                              event.dataTransfer.setData('text/plain', cell.id);
                              event.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragEnd={() => {
                              setDraggedCellId(null);
                              setDragOverLib(null);
                            }}
                            onDoubleClick={() => openCellView(cell.id)}
                            title={`Double-click to open · Drag onto another library to move ${cell.cellName}`}
                          >
                            <div className="cell-item__info">
                              <div
                                className={`cell-swatch cell-swatch--${cell.outlineStyle ?? 'solid'}`}
                              >
                                <i style={{ backgroundColor: cell.color, opacity: cell.opacity ?? 0.5 }} />
                              </div>
                              <div className="cell-item__text">
                                <div className="cell-item__title-row">
                                  <span className="cell-name" title={`${cell.libName}/${cell.cellName}`}>{cell.cellName}</span>
                                  {subCount > 0 && (
                                    <span className="subcount-badge" title={`${subCount} sub-instance${subCount === 1 ? '' : 's'} inside this cell`}>
                                      {subCount} sub
                                    </span>
                                  )}
                                </div>
                                <div className="cell-item__meta">
                                  <span className="size-badge">{cell.width.toFixed(1)}×{cell.height.toFixed(1)} µm</span>
                                </div>
                              </div>
                            </div>
                            <div className="cell-item__actions">
                              <button
                                className={`icon-btn${isOpenView ? ' icon-btn--active' : ''}`}
                                onClick={() => openCellView(cell.id)}
                                title={`Open ${cell.cellName} layout view`}
                              >
                                <FiEdit3 />
                              </button>
                              <button
                                className="icon-btn"
                                onClick={() => openCellViewInNewWindow(cell.id)}
                                title={`Open ${cell.cellName} in separate split window`}
                              >
                                <FiColumns />
                              </button>
                              <button className="icon-btn" onClick={() => openEditModal(cell)} title="Cell Properties">
                                <FiSettings />
                              </button>
                              <button
                                className="icon-btn"
                                style={{ color: blocksCycle ? 'var(--text-tertiary)' : '#2997ff', opacity: blocksCycle ? 0.35 : 1 }}
                                disabled={blocksCycle}
                                onClick={() => handleStartPlacement(cell.id)}
                                title={blocksCycle ? 'Cannot instantiate inside itself (would create a hierarchy cycle)' : `Instantiate ${cell.cellName} in ${topCellName}`}
                              >
                                <FiCrosshair />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                      {totalCells === 0 && (
                        <li className="virtuoso-lib-empty">Empty library · click + to add a cell</li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="section-header">
            <h3 className="section-title"><FiLayers /> Active View Tools</h3>
            <div className="section-actions">
              <button className="icon-btn" onClick={() => {
                setEditTopLibName(topLibName);
                setEditTopCellName(topCellName);
                setEditTopWidth(topWidth.toString());
                setEditTopHeight(topHeight.toString());
                setEditPadInset(padInset.toString());
                setShowEditTopModal(true);
              }} title="Edit Active Cell View Properties">
                <FiSettings />
              </button>
            </div>
          </div>
          <div className={`top-cell-card${activeCellId ? ' top-cell-card--subcell' : ''}`}>
            <div className="top-cell-card__row">
              <span className="cell-name">{topCellName}</span>
              <span className="lib-badge">{topLibName}</span>
            </div>
            <div className="top-cell-card__row">
              <div className="size-badge">
                {topWidth.toFixed(1)} × {topHeight.toFixed(1)} µm
              </div>
              {padInset > 0 && (
                <div className="lib-badge" title="Seal-ring / pad inset margin">
                  Inset {formatGridValue(padInset, gridSize)} µm
                </div>
              )}
            </div>
            {activeCellId && (
              <button
                type="button"
                className="return-top-btn"
                onClick={() => openCellView(null)}
                title={`Return to Top Cell (${rootLibName}/${rootCellName})`}
              >
                <FiArrowUpLeft /> Back to {rootCellName}
              </button>
            )}
          </div>
          <button className="edge-pad-action" type="button" onClick={() => {
            setPadLibName(topLibName);
            setPadInsetDraft(padInset.toString());
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
                <small>{pixelArray ? `${pixelArray.width} × ${pixelArray.height} µm · only overlap-capable cell` : 'Only cell allowed to overlap other blocks'}</small>
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
            <h3 className="section-title"><FiBox /> {topCellName} Instances</h3>
            <span className="lib-badge">{instances.length}</span>
          </div>
          {instances.length > 0 && (
            <div className="instance-filter-bar">
              <div className="instance-search-wrap">
                <FiSearch className="instance-search-icon" />
                <input
                  type="text"
                  className="input-field instance-search-input"
                  placeholder="Filter by name or master…"
                  value={instanceQuery}
                  onChange={event => setInstanceQuery(event.target.value)}
                  aria-label="Filter instances"
                />
              </div>
              <div className="instance-kind-tabs" role="tablist" aria-label="Filter instance type">
                {(['all', 'ip', 'pad'] as const).map(kind => (
                  <button
                    key={kind}
                    type="button"
                    role="tab"
                    aria-selected={instanceFilter === kind}
                    className={instanceFilter === kind ? 'active' : ''}
                    onClick={() => setInstanceFilter(kind)}
                  >
                    {kind === 'all' ? 'All' : kind === 'ip' ? 'IPs' : 'Pads'}
                  </button>
                ))}
              </div>
            </div>
          )}
          <ul className="instance-list">
            {instances.filter(inst => {
              const master = masterCells[inst.cellId];
              if (!master) return false;
              const isPad = master.kind === 'pad';
              if (instanceFilter === 'ip' && isPad) return false;
              if (instanceFilter === 'pad' && !isPad) return false;
              const q = instanceQuery.trim().toLowerCase();
              if (!q) return true;
              return inst.name.toLowerCase().includes(q) || master.cellName.toLowerCase().includes(q);
            }).map(inst => {
              const master = masterCells[inst.cellId];
              if (!master) return null;
              return (
                <li 
                  key={inst.id}
                  className={`instance-item ${selectedInstanceIds.includes(inst.id) ? 'active' : ''}`}
                  onClick={(event) => setSelectedInstance(inst.id, event.shiftKey)}
                  onDoubleClick={() => descendIntoInstance(inst.id)}
                  title="Click to select · Double-click to descend into cell view"
                >
                  <div className="inst-header">
                    <FiTarget className="inst-icon" />
                    <span className="inst-name">{inst.name}</span>
                    <span className="inst-master">({master.cellName})</span>
                    {inst.locked && (
                      <span className="inst-lock-badge" title="Locked">
                        <FiLock />
                      </span>
                    )}
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

    {showNewLibModal && (
      <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget) setShowNewLibModal(false); }}>
        <div className="modal-content glass-panel">
          <div className="modal-header">
            <h2 className="modal-title">New Virtuoso Library</h2>
            <button type="button" className="modal-close-btn" onClick={() => setShowNewLibModal(false)}>
              <FiX />
            </button>
          </div>
          <form onSubmit={handleCreateLibrarySubmit}>
            <div className="form-group">
              <label className="label">Library Name</label>
              <input
                className="input-field"
                value={newLibraryDraft}
                onChange={e => setNewLibraryDraft(e.target.value)}
                placeholder="e.g. xxxL_TOP, analog_lib, io_lib"
                required
                autoFocus
              />
              <small className="field-help">Libraries group cells and map 1:1 to Cadence Virtuoso ddGetObj libraries in SKILL export.</small>
            </div>
            <label className="checkbox-label" style={{ marginTop: '8px' }}>
              <input
                type="checkbox"
                checked={moveAllIntoNewLib}
                onChange={event => setMoveAllIntoNewLib(event.target.checked)}
              />
              Move all existing cells ({Object.keys(masterCells).length + 1}) into this library
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowNewLibModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Create Library</button>
            </div>
          </form>
        </div>
      </div>
    )}

    {showCreateModal && (
          <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget) { setShowCreateModal(false); setEditingCellId(null); } }}>
            <div className="modal-content glass-panel master-modal">
              <div className="modal-header">
                <h2 className="modal-title">{editingCellId ? 'Cell View Properties' : 'New Cell View (layout)'}</h2>
                <div style={{display: 'flex', gap: '8px'}}>
                  {editingCellId && (
                    <button 
                      type="button" 
                      className="modal-close-btn" 
                      style={{color: '#ef4444'}} 
                      onClick={() => {
                        if (confirm('Delete this Cell View and all its instances across the hierarchy?')) {
                          deleteMasterCell(editingCellId);
                          setShowCreateModal(false);
                          setEditingCellId(null);
                        }
                      }} 
                      title="Delete Cell"
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
                  <div className="field-label-row">
                    <label className="label">Library</label>
                    <button
                      type="button"
                      className="text-action"
                      onClick={() => {
                        const created = prompt('Create a new Cadence library:');
                        if (!created?.trim()) return;
                        try {
                          createLibrary(created.trim());
                          setNewLibName(created.trim());
                        } catch (error) {
                          alert(error instanceof Error ? error.message : 'Unable to create library.');
                        }
                      }}
                    >
                      + New Library
                    </button>
                  </div>
                  <input
                    className="input-field"
                    list="project-libraries"
                    value={newLibName}
                    onChange={e => setNewLibName(e.target.value)}
                    placeholder="Select or enter library..."
                    required
                  />
                </div>
                <div className="form-row">
                  <div className="form-group" style={{ flex: 2 }}>
                    <label className="label">Cell Name</label>
                    <input className="input-field" value={newCellName} onChange={e => setNewCellName(e.target.value)} placeholder="e.g. ANALOG_TOP" required autoFocus />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="label">View</label>
                    <input className="input-field locked-library" value="layout" readOnly aria-label="Cell view type" />
                  </div>
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
                  <div className="color-swatch-grid">
                    {PRESET_COLORS.map(c => (
                      <button
                        key={c}
                        type="button"
                        className={`color-swatch-btn${newColor === c ? ' active' : ''}`}
                        onClick={() => setNewColor(c)}
                        style={{ backgroundColor: c }}
                        aria-label={`Select color ${c}`}
                        aria-pressed={newColor === c}
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
                {!editingCellId && (
                  <label className="checkbox-label" style={{ marginTop: '12px' }}>
                    <input
                      type="checkbox"
                      checked={openCellAfterCreate}
                      onChange={event => setOpenCellAfterCreate(event.target.checked)}
                    />
                    Open layout view in editor immediately after creating
                  </label>
                )}
                <div className="modal-actions">
                  <button type="button" className="btn" onClick={() => { setShowCreateModal(false); setEditingCellId(null); }}>Cancel</button>
                  <button type="submit" className="btn btn-primary">{editingCellId ? 'Save Changes' : 'Create Cell View'}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showInstantiateModal && (
          <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget) setShowInstantiateModal(false); }}>
            <div className="modal-content glass-panel create-instance-modal">
              <div className="modal-header">
                <div>
                  <span className="modal-eyebrow">Virtuoso · Target: {topLibName}/{topCellName}</span>
                  <h2 className="modal-title">Create Instance</h2>
                </div>
                <button type="button" className="modal-close-btn" onClick={() => setShowInstantiateModal(false)}>
                  <FiX />
                </button>
              </div>
              <form onSubmit={handleInstantiateSubmit}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="label">Library</label>
                    <select
                      className="input-field"
                      value={instLibFilter}
                      onChange={e => {
                        const nextLib = e.target.value;
                        setInstLibFilter(nextLib);
                        const nextList = Object.values(masterCells)
                          .filter(c => !wouldCreateHierarchyCycle(activeCellId, c.id, effectiveCellViews))
                          .filter(c => nextLib === 'ALL' || c.libName === nextLib);
                        if (nextList[0]) {
                          setInstantiateSelection(nextList[0].id);
                          setInstDeltaX(String(nextList[0].width));
                          setInstDeltaY(String(nextList[0].height));
                        } else {
                          setInstantiateSelection('');
                        }
                      }}
                    >
                      <option value="ALL">All Libraries</option>
                      {availableLibraries.map(lib => (
                        <option key={lib} value={lib}>{lib}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label">View</label>
                    <input className="input-field locked-library" value="layout" readOnly />
                  </div>
                </div>
                <div className="form-group">
                  <label className="label">Cell</label>
                  <select 
                    className="input-field" 
                    value={instantiateSelection} 
                    onChange={e => {
                      const nextId = e.target.value;
                      setInstantiateSelection(nextId);
                      const chosen = masterCells[nextId];
                      if (chosen) {
                        setInstDeltaX(String(chosen.width));
                        setInstDeltaY(String(chosen.height));
                      }
                    }}
                  >
                    {eligibleInstantiateCells.length === 0 && <option value="" disabled>No eligible cells in this library</option>}
                    {eligibleInstantiateCells.map(cell => (
                      <option key={cell.id} value={cell.id}>
                        {cell.libName} / {cell.cellName} ({cell.width} × {cell.height} µm)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="label">Instance Name (optional)</label>
                    <input
                      className="input-field"
                      value={instNamePrefix}
                      onChange={e => setInstNamePrefix(e.target.value)}
                      placeholder="Auto (I0, I1...)"
                    />
                  </div>
                  <div className="form-group">
                    <label className="label">Orientation</label>
                    <div className="inst-orient-row">
                      <select
                        className="input-field"
                        value={instOrientation}
                        onChange={e => setInstOrientation(e.target.value)}
                      >
                        {ORIENTATION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Rotate +90°"
                        onClick={() => setInstOrientation(o => rotateOrientationByQuarterTurns(o, 1))}
                      >
                        <FiRotateCw />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="label">Rows</label>
                    <input type="number" min="1" max="100" step="1" className="input-field" value={instRows} onChange={e => setInstRows(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="label">Columns</label>
                    <input type="number" min="1" max="100" step="1" className="input-field" value={instCols} onChange={e => setInstCols(e.target.value)} />
                  </div>
                  {(Number(instRows) > 1 || Number(instCols) > 1) && (
                    <>
                      <div className="form-group">
                        <label className="label">ΔX (um)</label>
                        <input type="number" step="any" className="input-field" value={instDeltaX} onChange={e => setInstDeltaX(e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label className="label">ΔY (um)</label>
                        <input type="number" step="any" className="input-field" value={instDeltaY} onChange={e => setInstDeltaY(e.target.value)} />
                      </div>
                    </>
                  )}
                </div>
                <small className="field-help">Tip: Press <strong>R</strong> or right-click while placing on canvas to rotate before clicking. Press <strong>Esc</strong> when done.</small>
                <div className="modal-actions">
                  <button type="button" className="btn" onClick={() => setShowInstantiateModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={eligibleInstantiateCells.length === 0}>
                    Hide &amp; Place
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

    {showEditTopModal && (
      <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget) setShowEditTopModal(false); }}>
        <div className="modal-content glass-panel">
          <div className="modal-header">
            <h2 className="modal-title">{activeCellId ? 'Edit Active Cell View' : 'Edit Top Cell'}</h2>
            <button type="button" className="modal-close-btn" onClick={() => setShowEditTopModal(false)}>
              <FiX />
            </button>
          </div>
          <form onSubmit={(e) => {
            e.preventDefault();
            try {
              setTopConfig(
                editTopLibName,
                editTopCellName,
                Number.parseFloat(editTopWidth),
                Number.parseFloat(editTopHeight),
                Number.parseFloat(editPadInset || '0'),
              );
              setShowEditTopModal(false);
            } catch (error) {
              alert(error instanceof Error ? error.message : 'Unable to update the top cell.');
            }
          }}>
            <div className="form-group">
              <label className="label">Library Name</label>
              <input className="input-field" list="project-libraries" value={editTopLibName} onChange={e => setEditTopLibName(e.target.value)} required />
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
            <div className="form-group">
              <label className="label">Pad Edge Inset / Seal Ring (um)</label>
              <input type="number" min="0" step="any" className="input-field" value={editPadInset} onChange={e => setEditPadInset(e.target.value)} />
              <small className="field-help">Optional margin from the die edge reserved for seal ring / scribe line before edge pads attach.</small>
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
      <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget) setShowPadModal(false); }}>
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
              <span><b>2</b>{padPlacementMode === 'row' ? ' Choose edge, count, pitch, and rotation' : ' Set group count and pitch; rotation follows the hovered edge'}</span>
              <span><b>3</b>{padPlacementMode === 'row' ? ' Drag pads around the perimeter later' : ' Click each group; leave any gap between groups'}</span>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="label">Library Name</label>
                <input
                  className="input-field"
                  list="project-libraries"
                  value={padLibName}
                  onChange={event => setPadLibName(event.target.value)}
                  required
                  aria-label="Pad master library name"
                />
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
              <div className="form-group">
                <label className="label">Seal-Ring Inset (um)</label>
                <input type="number" min="0" step="any" className="input-field" value={padInsetDraft} onChange={event => setPadInsetDraft(event.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="label">Orientation (Virtuoso)</label>
                {padPlacementMode === 'manual' ? (
                  <div className="input-field locked-library">Automatic by hovered edge</div>
                ) : (
                  <select className="input-field" value={padAutoOrient ? resolvedPadOrientation : padOrientation} onChange={event => setPadOrientation(event.target.value)} disabled={padAutoOrient}>
                    {['R0', 'R90', 'R180', 'R270'].map(orientation => <option key={orientation} value={orientation}>{orientation}</option>)}
                  </select>
                )}
                {padPlacementMode === 'row' ? (
                  <label className="checkbox-label">
                    <input type="checkbox" checked={padAutoOrient} onChange={event => setPadAutoOrient(event.target.checked)} />
                    Auto by edge ({resolvedPadOrientation})
                  </label>
                ) : <small>Top R0 · Right R270 · Bottom R180 · Left R90</small>}
              </div>
              <div className="form-group pad-fit-hint">
                <span className="label">Placed footprint</span>
                <strong>{padPlacementMode === 'manual' ? 'Updates with edge' : `${Number.isFinite(padPhysicalWidth) ? padPhysicalWidth.toFixed(3) : '—'} × ${Number.isFinite(padPhysicalHeight) ? padPhysicalHeight.toFixed(3) : '—'} um`}</strong>
                <small>{padPlacementMode === 'manual' ? 'The canvas preview shows the rotated footprint' : padRotated ? `${resolvedPadOrientation} swaps physical width and height` : `${resolvedPadOrientation} uses defined width and height`}</small>
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
                  <div><strong>Each click places one auto-rotated group.</strong><span>The preview follows and rotates for the nearest edge. Click again after any keep-out gap or on another edge; every pad reuses the same Cadence cell. Press Esc when finished.</span></div>
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
                <span>SKILL collects every pad in <strong>{topCellName}_PAD_BANK</strong> and places that cell at (0,0).</span>
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
      <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget) setShowPixelArrayModal(false); }}>
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
      <datalist id="project-libraries">
        {availableLibraries.map(lib => (
          <option key={lib} value={lib} />
        ))}
      </datalist>
    </>
  );
};
