import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getProjectSnapshot, makeShapeAlignmentId, parseShapeAlignmentId, PIXEL_ARRAY_ALIGNMENT_ID, useStore } from '../store/useStore';
import { generateSkillCode, downloadSkillFile } from '../utils/skillExport';
import type { SkillExportOptions, SkillHierarchyMode } from '../utils/skillExport';
import { exportSVG, extractProjectFromSvg } from '../utils/svgExport';
import { computeFloorplanMetrics, downloadCsvFile, findBoundaryViolations, generateFloorplanCsv } from '../utils/floorplanMetrics';
import { createCisDemoProject } from '../utils/demoProjects';
import { formatGridValue } from '../utils/grid';
import { formatLppLabel } from '../utils/layoutLayers';
import { loadRecovery, parseProjectDocument, saveRecovery } from '../store/projectDocument';
import { FiDownload, FiSettings, FiMousePointer, FiMinimize2, FiSquare, FiType, FiCode, FiCopy, FiUpload, FiX, FiBookOpen, FiGrid, FiSave, FiBarChart2, FiAlertTriangle, FiCheckCircle, FiFolder, FiChevronDown, FiCpu, FiFileText, FiCrop, FiMove } from 'react-icons/fi';
import { TutorialModal } from './TutorialModal';
import { EditingToolbar } from './EditingToolbar';
import type { AlignmentAction } from './EditingToolbar';
import type { AlignmentEdge } from '../utils/alignment';
import type { ToastKind } from '../store/useStore';
import './Topbar.css';

export const Topbar: React.FC = () => {
  const { appMode, setAppMode, partialSelectMode, togglePartialSelectMode, topWidth, topHeight, topLibName, topCellName, padInset, libraries, setTopDimensions, masterCells, instances, rulers, shapes, activeCoordinateMode, pixelArray, pixelArraySelected, cellViews, activeCellId, descendStack, rootView, openCellView, gridSize, setGridSize, showAutoDim, toggleAutoDim, showOverlapDrc, toggleOverlapDrc, history, selectedInstanceId, selectedInstanceIds, selectedShapeId, setSelection, undo, redo, alignSelectedInstances, spaceSelectedInstances, alignSelectedInstancesToBoundary, distributeSelectedInstances, startEdgeAlignment, edgeAlignmentSession, setEdgeAlignmentOffset, cancelEdgeAlignment, pushToast } = useStore();
  const [showConfig, setShowConfig] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipNextGridBlurRef = useRef(false);
  const [showTutorial, setShowTutorial] = useState(() => {
    try {
      return localStorage.getItem('ic-floorplanner:tutorial-seen:v19') !== 'yes';
    } catch {
      return true;
    }
  });
  const [tempW, setTempW] = useState(topWidth.toString());
  const [tempH, setTempH] = useState(topHeight.toString());
  const [tempGrid, setTempGrid] = useState(() => formatGridValue(gridSize, gridSize));
  const [draftGridSize, setDraftGridSize] = useState(() => formatGridValue(gridSize, gridSize));
  
  const [showCodePreview, setShowCodePreview] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [preserveExistingMasters, setPreserveExistingMasters] = useState(false);
  const [hierarchyMode, setHierarchyMode] = useState<SkillHierarchyMode>('zero-origin-direct');
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const recoveryLoaded = useRef(false);
  const activeViewSnapshot = useMemo(() => ({
    gridSize,
    topWidth,
    topHeight,
    topLibName,
    topCellName,
    masterCells,
    instances,
    rulers,
    shapes,
    pixelArray,
    ...(padInset > 0 ? { padInset } : {}),
  }), [gridSize, topWidth, topHeight, topLibName, topCellName, padInset, masterCells, instances, rulers, shapes, pixelArray]);
  const canonicalSnapshot = useMemo(
    () => getProjectSnapshot({
      ...activeViewSnapshot,
      activeCoordinateMode,
      padInset,
      libraries,
      cellViews,
      activeCellId,
      rootView,
    }),
    [activeViewSnapshot, activeCoordinateMode, padInset, libraries, cellViews, activeCellId, rootView],
  );
  const projectSignature = useMemo(() => JSON.stringify(canonicalSnapshot), [canonicalSnapshot]);
  const metrics = useMemo(() => computeFloorplanMetrics(activeViewSnapshot), [activeViewSnapshot]);
  const drcBoundaryViolations = useMemo(() => {
    if (activeCellId === null) return metrics.boundaryViolations;
    if (descendStack.length > 0 && descendStack[0].parentCellId === null) {
      return findBoundaryViolations(canonicalSnapshot);
    }
    return [];
  }, [activeCellId, descendStack, metrics.boundaryViolations, canonicalSnapshot]);
  const boundaryLabel = activeCellId !== null && descendStack.length > 0 && descendStack[0].parentCellId === null && rootView
    ? rootView.topCellName
    : topCellName;
  const isDirty = savedSignature === null ? history.past.length > 0 : projectSignature !== savedSignature;
  const saveStatus = isDirty ? 'Unsaved' : savedSignature === null ? 'Not saved' : 'Saved';
  const selectedRectShape = selectedShapeId
    ? shapes.find(shape => shape.id === selectedShapeId && shape.kind !== 'text') ?? null
    : null;
  const alignmentSource = edgeAlignmentSession
    ? instances.find(instance => instance.id === edgeAlignmentSession.sourceId)
    : null;
  const alignmentSourceShape = edgeAlignmentSession
    ? (() => {
        const sid = parseShapeAlignmentId(edgeAlignmentSession.sourceId);
        return sid ? shapes.find(shape => shape.id === sid) ?? null : null;
      })()
    : null;
  const alignmentSourceName = edgeAlignmentSession?.sourceId === PIXEL_ARRAY_ALIGNMENT_ID
    ? 'Pixel Array'
    : alignmentSourceShape
      ? (alignmentSourceShape.label?.trim() || formatLppLabel(alignmentSourceShape.layer, alignmentSourceShape.purpose))
      : edgeAlignmentSession && edgeAlignmentSession.sourceIds.length > 1
        ? `${edgeAlignmentSession.sourceIds.length} selected objects${edgeAlignmentSession.sourceEdge ? ` via ${alignmentSource?.name ?? 'chosen edge'}` : ''}`
        : alignmentSource?.name ?? 'IP';
  const alignmentAxis = edgeAlignmentSession?.sourceEdge
    ? (edgeAlignmentSession.sourceEdge === 'left' || edgeAlignmentSession.sourceEdge === 'right' || edgeAlignmentSession.sourceEdge === 'horizontal-center'
        ? 'horizontally'
        : 'vertically')
    : null;
  const alignmentStep = edgeAlignmentSession?.sourceEdge
    ? 'Click any green/cyan edge (IP, sub-cell, parent cell, boundary, or ruler)'
    : edgeAlignmentSession && edgeAlignmentSession.sourceIds.length > 1
      ? 'Click an amber edge on any selected object'
      : `Click an amber edge of ${alignmentSourceName}`;

  const showToast = useCallback((message: string, kind: ToastKind = 'success') => {
    pushToast(message, kind);
  }, [pushToast]);

  useEffect(() => {
    setDraftGridSize(formatGridValue(gridSize, gridSize));
  }, [gridSize]);

  const commitGridSize = () => {
    if (skipNextGridBlurRef.current) {
      skipNextGridBlurRef.current = false;
      return;
    }
    const size = Number(draftGridSize);
    if (!Number.isFinite(size) || size <= 0) {
      setDraftGridSize(formatGridValue(gridSize, gridSize));
      return;
    }
    if (size === gridSize) {
      setDraftGridSize(formatGridValue(gridSize, gridSize));
      return;
    }
    try {
      setGridSize(size);
    } catch (error) {
      setDraftGridSize(formatGridValue(gridSize, gridSize));
      showToast(error instanceof Error ? error.message : 'Unable to apply that placement grid.', 'error');
    }
  };

  const createSkillCode = (optionsOverride?: SkillExportOptions) => {
    const snapshot = getProjectSnapshot(useStore.getState());
    const options: SkillExportOptions = {
      preserveExistingMasters,
      hierarchyMode,
      cellViews: snapshot.cellViews,
      topShapes: snapshot.shapes,
      ...optionsOverride,
    };
    try {
      return generateSkillCode(
        snapshot.topLibName,
        snapshot.topCellName,
        snapshot.topWidth,
        snapshot.topHeight,
        snapshot.masterCells,
        snapshot.instances,
        snapshot.gridSize,
        snapshot.pixelArray,
        options,
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to generate Cadence SKILL code.', 'error');
      return null;
    }
  };

  const handleExport = () => {
    const skillCode = createSkillCode();
    if (!skillCode) return;
    const snapshot = getProjectSnapshot(useStore.getState());
    const filename = `${snapshot.topCellName}.il`;
    downloadSkillFile(filename, skillCode);
    showToast(`${filename} downloaded`);
  };

  const handleExportCsv = () => {
    try {
      const csv = generateFloorplanCsv(activeViewSnapshot);
      const filename = `${topCellName}_floorplan.csv`;
      downloadCsvFile(filename, csv);
      showToast(`${filename} exported`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to export the CSV table.', 'error');
    }
  };

  const handleLoadDemo = () => {
    if (isDirty && !confirm('Load the live CIS demo floorplan and discard current unsaved changes?')) {
      return;
    }
    const demo = createCisDemoProject();
    useStore.getState().loadProject(demo);
    setSavedSignature(JSON.stringify(getProjectSnapshot(useStore.getState())));
    showToast('Loaded 2MP CIS Sensor demo floorplan', 'info');
  };

  const handleSaveWorkspace = useCallback(() => {
    const snapshot = getProjectSnapshot(useStore.getState());
    if (!saveRecovery(snapshot)) {
      showToast('Unable to save workspace in this browser. Check storage settings.', 'error');
      return;
    }
    setSavedSignature(JSON.stringify(snapshot));
    showToast('Workspace saved in this browser');
  }, [showToast]);

  const handleExportSvg = () => {
    try {
      const filename = exportSVG();
      showToast(`${filename} exported`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to export the SVG floorplan.', 'error');
    }
  };

  useEffect(() => {
    if (recoveryLoaded.current) return;
    recoveryLoaded.current = true;
    const recovered = loadRecovery();
    if (!recovered) return;
    useStore.getState().loadProject(recovered);
    setSavedSignature(JSON.stringify(getProjectSnapshot(useStore.getState())));
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        handleSaveWorkspace();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [handleSaveWorkspace]);

  useEffect(() => {
    const closeModalsOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isFileMenuOpen) setIsFileMenuOpen(false);
      else if (showCodePreview) setShowCodePreview(false);
      else if (showSummary) setShowSummary(false);
      else if (showConfig) setShowConfig(false);
    };
    window.addEventListener('keydown', closeModalsOnEscape);
    return () => window.removeEventListener('keydown', closeModalsOnEscape);
  }, [isFileMenuOpen, showCodePreview, showSummary, showConfig]);

  useEffect(() => {
    if (!isFileMenuOpen) return;
    const handleOutside = (event: PointerEvent) => {
      if (!fileMenuRef.current?.contains(event.target as Node)) setIsFileMenuOpen(false);
    };
    window.addEventListener('pointerdown', handleOutside);
    return () => window.removeEventListener('pointerdown', handleOutside);
  }, [isFileMenuOpen]);

  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [isDirty]);
  
  const handlePreview = () => {
    const code = createSkillCode();
    if (!code) return;
    setGeneratedCode(code);
    setShowCodePreview(true);
  };

  const handleLoadProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (isDirty && !confirm('Open another project and discard the current unsaved changes?')) {
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      try {
        const extracted = extractProjectFromSvg(text);
        const jsonData = extracted ? parseProjectDocument(extracted) : parseProjectDocument(text);
        
        if (jsonData) {
          useStore.getState().loadProject(jsonData);
          setSavedSignature(JSON.stringify(getProjectSnapshot(useStore.getState())));
          showToast(`${jsonData.topCellName} opened`);
        } else {
          throw new Error('No valid data found');
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Invalid SVG project. Choose an SVG exported from this tool.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleAlignment = (action: AlignmentAction, distance = 0) => {
    try {
      const distSuffix = Math.abs(distance) > 1e-9 ? ` (${distance} µm)` : '';
      if (action === 'distribute-horizontal') {
        distributeSelectedInstances('horizontal');
        showToast('Distributed horizontally', 'info');
      } else if (action === 'distribute-vertical') {
        distributeSelectedInstances('vertical');
        showToast('Distributed vertically', 'info');
      } else if (action === 'space-horizontal') {
        spaceSelectedInstances('horizontal', distance);
        showToast(Math.abs(distance) <= 1e-9 ? 'Abutted horizontally (0 µm)' : `Spaced horizontally (${distance} µm)`, 'info');
      } else if (action === 'space-vertical') {
        spaceSelectedInstances('vertical', distance);
        showToast(Math.abs(distance) <= 1e-9 ? 'Abutted vertically (0 µm)' : `Spaced vertically (${distance} µm)`, 'info');
      } else {
        alignSelectedInstances(action, distance);
        showToast(`Aligned ${action.replaceAll('-', ' ')}${distSuffix}`, 'info');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to arrange the selected blocks.', 'error');
    }
  };

  const handleAlignToBoundary = (edge: AlignmentEdge, distance = 0) => {
    try {
      alignSelectedInstancesToBoundary(edge, distance);
      const distSuffix = Math.abs(distance) > 1e-9 ? ` (${distance} µm)` : '';
      showToast(`Aligned to ${boundaryLabel} ${edge.replaceAll('-', ' ')}${distSuffix}`, 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to align to boundary.', 'error');
    }
  };

  const closeTutorial = () => {
    setShowTutorial(false);
    try {
      localStorage.setItem('ic-floorplanner:tutorial-seen:v19', 'yes');
    } catch {
      // The tutorial still closes when browser storage is unavailable.
    }
  };

  const openConfigModal = () => {
    setTempW(topWidth.toString());
    setTempH(topHeight.toString());
    setTempGrid(formatGridValue(gridSize, gridSize));
    setShowConfig(true);
  };

  const handleSaveConfig = (event?: React.FormEvent) => {
    event?.preventDefault();
    const width = Number.parseFloat(tempW);
    const height = Number.parseFloat(tempH);
    const nextGrid = Number.parseFloat(tempGrid);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      showToast('Top-cell width and height must be positive numbers.', 'error');
      return;
    }
    if (!Number.isFinite(nextGrid) || nextGrid <= 0) {
      showToast('Grid size must be a positive number.', 'error');
      return;
    }
    try {
      if (Math.abs(nextGrid - gridSize) > 1e-12) {
        setGridSize(nextGrid);
      }
      setTopDimensions(width, height);
      setShowConfig(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to update top-cell configuration.', 'error');
    }
  };

  return (
    <>
      <div className="topbar glass-panel">
      <div className="topbar-left">
        <div className="logo">
          <div className="logo-icon"></div>
          <h1>IC Floorplanner</h1>
        </div>
        
        <div className="mode-toggle">
          <button 
            className={`mode-btn ${appMode === 'select' ? 'active' : ''}`}
            onClick={() => setAppMode('select')}
            title="Select & Move (M)"
          >
            <FiMousePointer /> <span className="topbar-label-sm">Select</span>
          </button>
          <button
            className={`mode-btn${partialSelectMode ? ' active' : ''}`}
            onClick={togglePartialSelectMode}
            title="Virtuoso Partial Select (F4): box-select or click individual rectangle edges/corners, then press S to stretch"
            aria-pressed={partialSelectMode}
          >
            <FiCrop /> <span className="topbar-label-lg">Partial</span>
          </button>
          <button
            className={`mode-btn ${appMode === 'stretch' ? 'active' : ''}`}
            onClick={() => setAppMode(appMode === 'stretch' ? 'select' : 'stretch')}
            title="Virtuoso Stretch (S): drag a box over rectangle edge(s)/corner(s) to partially select, then drag to stretch"
            aria-pressed={appMode === 'stretch'}
          >
            <FiMove /> <span className="topbar-label-lg">Stretch</span>
          </button>
          <span className="mode-toggle__sep" aria-hidden="true" />
          <button
            className={`mode-btn ${appMode === 'rect' ? 'active' : ''}`}
            onClick={() => setAppMode(appMode === 'rect' ? 'select' : 'rect')}
            title="Draw Rectangle on Virtuoso Layer/Purpose (R when idle, or D)"
            aria-pressed={appMode === 'rect'}
          >
            <FiSquare /> <span className="topbar-label-sm">Rect</span>
          </button>
          <button
            className={`mode-btn ${appMode === 'text' ? 'active' : ''}`}
            onClick={() => setAppMode(appMode === 'text' ? 'select' : 'text')}
            title="Create Text Label (L): place text on text/drawing or any custom layer with selectable font size & style"
            aria-pressed={appMode === 'text'}
          >
            <FiType /> <span className="topbar-label-sm">Text</span>
          </button>
          <span className="mode-toggle__sep" aria-hidden="true" />
          <button 
            className={`mode-btn ${appMode === 'measure' ? 'active' : ''}`}
            onClick={() => setAppMode(appMode === 'measure' ? 'select' : 'measure')}
            title="Measure Distance / Rulers (K)"
            aria-pressed={appMode === 'measure'}
          >
            <FiMinimize2 /> <span className="topbar-label-sm">Ruler</span>
          </button>
          <button
            className={`mode-btn mode-btn--autodim${showAutoDim ? ' active' : ''}`}
            onClick={toggleAutoDim}
            title="Auto-Dimension: nearest clearances across IPs, drawn shapes, sub-cell walls, and Edit-in-Place context"
            aria-pressed={showAutoDim}
          >
            <FiGrid /> <span className="topbar-label-lg">Auto-Dim</span>
          </button>
        </div>
      </div>

      <div className="topbar-right">
        {edgeAlignmentSession ? (
          <div className="topbar-align" role="status" aria-label="Align by edges">
            <div className="topbar-align__identity">
              <span className="topbar-align__dot" />
              <div>
                <strong>{alignmentAxis ? `Move ${alignmentSourceName} ${alignmentAxis}` : `Align ${alignmentSourceName}`}</strong>
                <span>{alignmentStep}</span>
              </div>
            </div>
            <label className="topbar-align__offset">
              Distance
              <input
                type="text"
                inputMode="decimal"
                value={edgeAlignmentSession.offset}
                onChange={event => setEdgeAlignmentOffset(event.target.value)}
                onFocus={event => event.currentTarget.select()}
                onKeyDown={event => {
                  if (event.key === 'Escape') cancelEdgeAlignment();
                  else if (event.key === 'Enter') event.currentTarget.blur();
                }}
                aria-label="Alignment distance in micrometers (default 0)"
              />
              <span>µm</span>
            </label>
            {edgeAlignmentSession.offset.trim() !== '0' && (
              <button
                type="button"
                className="editing-toolbar__distance-chip"
                onClick={() => setEdgeAlignmentOffset('0')}
                title="Reset distance to 0 µm"
              >
                0
              </button>
            )}
            <span className="topbar-align__hint">Directional edge distance · default 0</span>
            <button className="topbar-align__cancel" type="button" onClick={cancelEdgeAlignment} aria-label="Cancel edge alignment" title="Cancel alignment (Esc)">
              <FiX />
            </button>
          </div>
        ) : <>
          <EditingToolbar
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            undoLabel={history.past[history.past.length - 1]?.label}
            redoLabel={history.future[0]?.label}
            selectionCount={pixelArraySelected || selectedRectShape ? 1 : selectedInstanceIds.length}
            anchorName={
              pixelArraySelected
                ? 'Pixel Array'
                : selectedRectShape
                  ? (selectedRectShape.label?.trim() || formatLppLabel(selectedRectShape.layer, selectedRectShape.purpose))
                  : instances.find(instance => instance.id === selectedInstanceId)?.name
            }
            boundaryLabel={boundaryLabel}
            onUndo={undo}
            onRedo={redo}
            onAlign={handleAlignment}
            onAlignToBoundary={handleAlignToBoundary}
            onStartEdgeAlign={(initialDistance) => {
              setAppMode('select');
              if (pixelArraySelected) startEdgeAlignment(PIXEL_ARRAY_ALIGNMENT_ID, initialDistance);
              else if (selectedRectShape) startEdgeAlignment(makeShapeAlignmentId(selectedRectShape.id), initialDistance);
              else if (selectedInstanceId) startEdgeAlignment(selectedInstanceId, initialDistance);
            }}
          />

          <button className={`btn save-btn${isDirty ? ' has-unsaved' : ''}`} onClick={handleSaveWorkspace} title={`Save workspace in browser (Ctrl/Cmd+S) · ${saveStatus}`}>
            <FiSave />
            <span className="topbar-label-md">Save</span>
            <span className={`save-dot ${isDirty ? 'dirty' : savedSignature === null ? 'new' : 'saved'}`} aria-label={saveStatus} />
          </button>

          <div className="topbar-file-menu" ref={fileMenuRef}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".svg,.flp,.json,image/svg+xml"
              onChange={handleLoadProject}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              className="btn"
              onClick={() => setIsFileMenuOpen(open => !open)}
              aria-expanded={isFileMenuOpen}
              aria-haspopup="menu"
              title="Import SVG, export SVG/CSV, or load demo"
            >
              <FiFolder />
              <span className="topbar-label-md">File</span>
              <FiChevronDown />
            </button>
            {isFileMenuOpen && (
              <div className="topbar-dropdown" role="menu" aria-label="Project file actions">
                <button
                  type="button"
                  className="topbar-dropdown__item"
                  role="menuitem"
                  onClick={() => {
                    setIsFileMenuOpen(false);
                    handleSaveWorkspace();
                  }}
                >
                  <FiSave /> <span>Save in Browser</span>
                  <kbd className="kbd-hint">Ctrl+S</kbd>
                </button>
                <div className="topbar-dropdown__divider" />
                <button
                  type="button"
                  className="topbar-dropdown__item"
                  role="menuitem"
                  onClick={() => {
                    setIsFileMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                >
                  <FiUpload /> <span>Import SVG / JSON…</span>
                </button>
                <button
                  type="button"
                  className="topbar-dropdown__item"
                  role="menuitem"
                  onClick={() => {
                    setIsFileMenuOpen(false);
                    handleExportSvg();
                  }}
                >
                  <FiDownload /> <span>Export Editable SVG</span>
                </button>
                <button
                  type="button"
                  className="topbar-dropdown__item"
                  role="menuitem"
                  onClick={() => {
                    setIsFileMenuOpen(false);
                    handleExportCsv();
                  }}
                >
                  <FiFileText /> <span>Export CSV Table</span>
                </button>
                <div className="topbar-dropdown__divider" />
                <button
                  type="button"
                  className="topbar-dropdown__item"
                  role="menuitem"
                  onClick={() => {
                    setIsFileMenuOpen(false);
                    handleLoadDemo();
                  }}
                >
                  <FiCpu /> <span>Load 2MP CIS Demo</span>
                </button>
              </div>
            )}
          </div>

          <div className="vertical-divider" />

          {activeCellId === null ? (
            <button
              className="btn config-btn"
              onClick={openConfigModal}
              title={`Configure Top Cell: ${topLibName}/${topCellName} (${topWidth} × ${topHeight} µm)`}
            >
              <FiSettings />
              <span className="config-btn__text">{topWidth}×{topHeight}</span>
            </button>
          ) : (
            <span
              className="btn config-btn"
              style={{ cursor: 'default', opacity: 0.85 }}
              title={
                topWidth <= 0 || topHeight <= 0
                  ? `${topLibName}/${topCellName} is empty — draw shapes or instantiate sub-cells to define its size`
                  : `${topLibName}/${topCellName} bounding box (${topWidth} × ${topHeight} µm) is derived automatically from its contents`
              }
            >
              <span className="config-btn__text">
                {topWidth <= 0 || topHeight <= 0 ? 'Empty cell' : `${formatGridValue(topWidth, gridSize)}×${formatGridValue(topHeight, gridSize)}`}
              </span>
            </span>
          )}
          <label
            className="grid-settings"
            title="Defined placement & anchor snap grid (µm) — fixed across zoom levels"
          >
            <span className="grid-settings__prefix">G</span>
            <input 
              type="text"
              inputMode="decimal"
              list="grid-size-presets"
              value={draftGridSize} 
              onChange={event => setDraftGridSize(event.target.value)}
              onBlur={commitGridSize}
              onKeyDown={event => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                  skipNextGridBlurRef.current = true;
                  setDraftGridSize(formatGridValue(gridSize, gridSize));
                  event.currentTarget.blur();
                }
              }}
              className="grid-input"
              aria-label="Placement grid in micrometers"
            />
            <span className="grid-settings__unit">µm</span>
            <datalist id="grid-size-presets">
              <option value="0.005" />
              <option value="0.01" />
              <option value="0.05" />
              <option value="0.1" />
              <option value="0.5" />
              <option value="1" />
              <option value="5" />
              <option value="10" />
              <option value="25" />
              <option value="50" />
              <option value="100" />
            </datalist>
          </label>
          <div className="vertical-divider vertical-divider--compact" />
          <button
            className={`btn metrics-btn${drcBoundaryViolations.length > 0 ? ' metrics-btn--warn' : ''}`}
            onClick={() => setShowSummary(true)}
            title={drcBoundaryViolations.length > 0
              ? `${drcBoundaryViolations.length} out-of-bounds warning${drcBoundaryViolations.length === 1 ? '' : 's'} — click to inspect summary & boundary check`
              : metrics.overlaps.length > 0
                ? `Floorplan area metrics, CSV export, and ${metrics.overlaps.length} non-fatal bounding-box overlap notice${metrics.overlaps.length === 1 ? '' : 's'}`
                : 'Floorplan area metrics, boundary status, and CSV export'}
          >
            {drcBoundaryViolations.length > 0 ? (
              <>
                <FiAlertTriangle />
                <span>{drcBoundaryViolations.length}</span>
                <span className="topbar-label-lg"> Out of Bounds</span>
              </>
            ) : (
              <><FiBarChart2 /> <span className="topbar-label-lg">Summary</span></>
            )}
          </button>
          <button
            className="btn shortcuts-btn topbar-icon-pill"
            onClick={() => setShowTutorial(true)}
            title="Help & Interactive Walkthrough"
            aria-label="Help and walkthrough"
          >
            <FiBookOpen />
          </button>
          <button className="btn btn-primary preview-btn" onClick={handlePreview} title="Preview & download Cadence Virtuoso SKILL">
            <FiCode /> <span>SKILL</span>
          </button>
        </>}
      </div>
      </div>

      {showConfig && (
        <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget) setShowConfig(false); }}>
          <form className="modal-content glass-panel config-modal" onSubmit={handleSaveConfig}>
            <div className="modal-header">
              <h2 className="modal-title">{activeCellId ? `Configure ${topCellName}` : 'Configure Top ASIC'}</h2>
              <button type="button" className="modal-close-btn" onClick={() => setShowConfig(false)}>
                <FiX />
              </button>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="label">Width (µm)</label>
                <input type="number" step="any" className="input-field" value={tempW} onChange={e => setTempW(e.target.value)} autoFocus />
              </div>
              <div className="form-group">
                <label className="label">Height (µm)</label>
                <input type="number" step="any" className="input-field" value={tempH} onChange={e => setTempH(e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="label">Placement Grid (µm)</label>
              <input type="number" step="any" min="0.0001" className="input-field" value={tempGrid} onChange={e => setTempGrid(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowConfig(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        </div>
      )}

      {showTutorial && (
        <TutorialModal onClose={closeTutorial} onLoadDemo={handleLoadDemo} />
      )}
      
      {showSummary && (
        <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget) setShowSummary(false); }}>
          <div className="modal-content glass-panel summary-modal">
            <div className="modal-header">
              <h2 className="modal-title">Floorplan Summary &amp; DRC</h2>
              <button className="modal-close-btn" onClick={() => setShowSummary(false)}>
                <FiX />
              </button>
            </div>
            <div className="summary-grid">
              <div className="summary-card">
                <span className="summary-card__label">Die Area</span>
                <strong>{metrics.dieAreaMm2.toFixed(4)} mm²</strong>
                <small>{metrics.dieAreaUm2.toLocaleString()} µm² · W/H {metrics.aspectRatio.toFixed(2)}</small>
              </div>
              <div className="summary-card">
                <span className="summary-card__label">IP Blocks ({metrics.ipCount})</span>
                <strong>{metrics.ipUtilizationPct.toFixed(1)}%</strong>
                <small>{metrics.ipAreaUm2.toLocaleString()} µm² total IP area</small>
              </div>
              <div className="summary-card">
                <span className="summary-card__label">Whitespace</span>
                <strong>{metrics.whitespacePct.toFixed(1)}%</strong>
                <small>{metrics.whitespaceUm2.toLocaleString()} µm² free (excl. IP &amp; pads)</small>
              </div>
              <div className="summary-card">
                <span className="summary-card__label">Pads ({metrics.padCount})</span>
                <strong>T:{metrics.padsBySide.top} R:{metrics.padsBySide.right} B:{metrics.padsBySide.bottom} L:{metrics.padsBySide.left}</strong>
                <small>{padInset > 0 ? `Seal-ring inset: ${formatGridValue(padInset, gridSize)} µm` : 'Attached flush to die edge'}</small>
              </div>
              {pixelArray?.visible && (
                <div className="summary-card">
                  <span className="summary-card__label">Pixel Array</span>
                  <strong>{metrics.pixelArrayPct.toFixed(1)}%</strong>
                  <small>{metrics.pixelArrayAreaUm2.toLocaleString()} µm² ({formatGridValue(pixelArray.width, gridSize)} × {formatGridValue(pixelArray.height, gridSize)} µm)</small>
                </div>
              )}
            </div>

            <div className="drc-section">
              <div className="drc-section__header">
                <h3 className="drc-section__title">
                  {drcBoundaryViolations.length === 0 ? (
                    <span className="drc-status drc-status--clean"><FiCheckCircle /> All instances within die boundary</span>
                  ) : (
                    <span className="drc-status drc-status--warn">
                      <FiAlertTriangle /> {drcBoundaryViolations.length} out-of-bounds warning{drcBoundaryViolations.length === 1 ? '' : 's'}
                    </span>
                  )}
                </h3>
              </div>
              {drcBoundaryViolations.length > 0 && (
                <ul className="drc-list">
                  {drcBoundaryViolations.map(violation => (
                    <li key={violation.id}>
                      <button
                        type="button"
                        className="drc-item drc-item--warn"
                        onClick={() => {
                          if (activeCellId !== null) openCellView(null);
                          setSelection([violation.instanceId]);
                          setShowSummary(false);
                        }}
                      >
                        <span className="drc-item__names">
                          <strong>{violation.instanceName}</strong> ({violation.cellName})
                        </span>
                        <span className="drc-item__meta">
                          <span className="drc-kind-badge drc-kind-badge--warn">OUT OF BOUNDS</span>
                          {violation.sides.join(', ')} +{formatGridValue(violation.maxOverflowUm, gridSize)} µm
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="drc-subsection">
                <div className="drc-section__header">
                  <h3 className="drc-section__title">
                    {metrics.overlaps.length === 0 ? (
                      <span className="drc-status drc-status--clean"><FiCheckCircle /> No bounding-box overlaps</span>
                    ) : (
                      <span className="drc-status drc-status--info">
                        ⓘ {metrics.overlaps.length} bounding-box overlap notice{metrics.overlaps.length === 1 ? '' : 's'} (non-fatal)
                      </span>
                    )}
                  </h3>
                  <label className="drc-toggle">
                    <input type="checkbox" checked={showOverlapDrc} onChange={toggleOverlapDrc} />
                    Highlight overlap boxes on canvas
                  </label>
                </div>
                {metrics.overlaps.length > 0 && (
                  <>
                    <p className="drc-note">
                      Non-fatal informational notice — hierarchical cells such as pad rings (<code>padring</code>) or subsystems (<code>asp_top</code>) naturally share bounding boxes with inner IPs. Overlap notices appear in each IP’s Properties panel and are not exported to SKILL.
                    </p>
                    <ul className="drc-list">
                      {metrics.overlaps.map(violation => (
                        <li key={violation.id}>
                          <button
                            type="button"
                            className="drc-item drc-item--info"
                            onClick={() => {
                              setSelection([violation.idA, violation.idB]);
                              setShowSummary(false);
                            }}
                          >
                            <span className="drc-item__names">
                              <strong>{violation.nameA}</strong> ↔ <strong>{violation.nameB}</strong>
                            </span>
                            <span className="drc-item__meta">
                              <span className="drc-kind-badge drc-kind-badge--info">{violation.kind.toUpperCase()}</span>
                              {formatGridValue(violation.width, gridSize)} × {formatGridValue(violation.height, gridSize)} µm ({violation.areaUm2.toFixed(2)} µm²)
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={() => setShowSummary(false)}>Close</button>
              <button className="btn btn-primary" onClick={handleExportCsv}>
                <FiDownload /> Export CSV Table
              </button>
            </div>
          </div>
        </div>
      )}

      {showCodePreview && (
        <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget) setShowCodePreview(false); }}>
          <div className="modal-content glass-panel code-preview-modal">
            <div className="modal-header">
              <h2 className="modal-title">SKILL Code Preview</h2>
              <button className="modal-close-btn" onClick={() => setShowCodePreview(false)}>
                <FiX />
              </button>
            </div>
            <div className="skill-options-bar">
              <div className="skill-mode-group" role="group" aria-label="SKILL hierarchy placement mode">
                <span className="skill-mode-label">Hierarchy:</span>
                <div className="skill-mode-segmented">
                  {([
                    {
                      value: 'zero-origin-direct' as SkillHierarchyMode,
                      label: '0:0 Direct IP',
                      title: 'Single-instance IP/sub-cells own their exact chip coordinates in their own library and are placed at 0:0 in parent/top cells (no wrappers).',
                    },
                    {
                      value: 'local-origin' as SkillHierarchyMode,
                      label: 'Local Origin',
                      title: 'Every master cell stays at 0:0..W:H and parent cells place instances directly at (x:y, orient).',
                    },
                    {
                      value: 'wrapped' as SkillHierarchyMode,
                      label: '0:0 Wrappers',
                      title: 'Wrap each top-level IP inside a <Top>_<Cell>_PLACED cell placed at 0:0.',
                    },
                  ]).map(option => (
                    <button
                      key={option.value}
                      type="button"
                      className={`skill-mode-btn${hierarchyMode === option.value ? ' active' : ''}`}
                      title={option.title}
                      aria-pressed={hierarchyMode === option.value}
                      onClick={() => {
                        setHierarchyMode(option.value);
                        const updated = createSkillCode({ hierarchyMode: option.value });
                        if (updated) setGeneratedCode(updated);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="skill-option-toggle">
                <input
                  type="checkbox"
                  checked={preserveExistingMasters}
                  onChange={event => {
                    const next = event.target.checked;
                    setPreserveExistingMasters(next);
                    const updated = createSkillCode({ preserveExistingMasters: next });
                    if (updated) setGeneratedCode(updated);
                  }}
                />
                <span>Preserve existing masters</span>
              </label>
            </div>
            <div className="code-container">
              <pre>
                {generatedCode}
              </pre>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowCodePreview(false)}>Close</button>
              <button className="btn" onClick={() => { 
                navigator.clipboard.writeText(generatedCode)
                  .then(() => showToast('SKILL code copied'))
                  .catch(() => showToast('Could not copy SKILL code', 'error'));
              }}>
                <FiCopy /> Copy to Clipboard
              </button>
              <button className="btn btn-primary export-btn" onClick={handleExport}>
                <FiDownload /> Download .il
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
