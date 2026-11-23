import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getProjectSnapshot, PIXEL_ARRAY_ALIGNMENT_ID, useStore } from '../store/useStore';
import { generateSkillCode, downloadSkillFile } from '../utils/skillExport';
import type { SkillExportOptions } from '../utils/skillExport';
import { exportSVG, extractProjectFromSvg } from '../utils/svgExport';
import { computeFloorplanMetrics, downloadCsvFile, generateFloorplanCsv } from '../utils/floorplanMetrics';
import { createCisDemoProject } from '../utils/demoProjects';
import { formatGridValue } from '../utils/grid';
import { loadRecovery, parseProjectDocument, saveRecovery } from '../store/projectDocument';
import { FiDownload, FiSettings, FiMousePointer, FiMinimize2, FiTrash2, FiCode, FiCopy, FiUpload, FiX, FiBookOpen, FiGrid, FiSave, FiBarChart2, FiAlertTriangle, FiCheckCircle } from 'react-icons/fi';
import { TutorialModal } from './TutorialModal';
import { EditingToolbar } from './EditingToolbar';
import type { AlignmentAction } from './EditingToolbar';
import { ToastViewport } from './ToastViewport';
import type { ToastKind, ToastMessage } from './ToastViewport';
import './Topbar.css';

export const Topbar: React.FC = () => {
  const { appMode, setAppMode, topWidth, topHeight, topLibName, topCellName, padInset, setTopDimensions, masterCells, instances, rulers, pixelArray, pixelArraySelected, gridSize, setGridSize, clearRulers, orthogonalRuler, toggleOrthogonalRuler, showAutoDim, toggleAutoDim, showOverlapDrc, toggleOverlapDrc, history, selectedInstanceId, selectedInstanceIds, setSelection, undo, redo, alignSelectedInstances, distributeSelectedInstances, startEdgeAlignment, edgeAlignmentSession, setEdgeAlignmentOffset, cancelEdgeAlignment } = useStore();
  const [showConfig, setShowConfig] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showTutorial, setShowTutorial] = useState(() => {
    try {
      return localStorage.getItem('ic-floorplanner:tutorial-seen:v19') !== 'yes';
    } catch {
      return true;
    }
  });
  const [tempW, setTempW] = useState(topWidth.toString());
  const [tempH, setTempH] = useState(topHeight.toString());
  const [draftGridSize, setDraftGridSize] = useState(() => formatGridValue(gridSize, gridSize));
  
  const [showCodePreview, setShowCodePreview] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [preserveExistingMasters, setPreserveExistingMasters] = useState(false);
  const [useIpWrappers, setUseIpWrappers] = useState(true);
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const recoveryLoaded = useRef(false);
  const currentSnapshot = useMemo(() => ({
    gridSize,
    topWidth,
    topHeight,
    topLibName,
    topCellName,
    masterCells,
    instances,
    rulers,
    pixelArray,
    ...(padInset > 0 ? { padInset } : {}),
  }), [gridSize, topWidth, topHeight, topLibName, topCellName, padInset, masterCells, instances, rulers, pixelArray]);
  const projectSignature = useMemo(() => JSON.stringify(currentSnapshot), [currentSnapshot]);
  const metrics = useMemo(() => computeFloorplanMetrics(currentSnapshot), [currentSnapshot]);
  const isDirty = savedSignature === null ? history.past.length > 0 : projectSignature !== savedSignature;
  const saveStatus = isDirty ? 'Unsaved' : savedSignature === null ? 'Not saved' : 'Saved';
  const alignmentSource = edgeAlignmentSession
    ? instances.find(instance => instance.id === edgeAlignmentSession.sourceId)
    : null;
  const alignmentSourceName = edgeAlignmentSession?.sourceId === PIXEL_ARRAY_ALIGNMENT_ID
    ? 'Pixel Array'
    : edgeAlignmentSession && edgeAlignmentSession.sourceIds.length > 1
      ? `${edgeAlignmentSession.sourceIds.length} selected objects${edgeAlignmentSession.sourceEdge ? ` via ${alignmentSource?.name ?? 'chosen edge'}` : ''}`
      : alignmentSource?.name ?? 'IP';
  const alignmentAxis = edgeAlignmentSession?.sourceEdge
    ? (edgeAlignmentSession.sourceEdge === 'left' || edgeAlignmentSession.sourceEdge === 'right' || edgeAlignmentSession.sourceEdge === 'horizontal-center'
        ? 'horizontally'
        : 'vertically')
    : null;
  const alignmentStep = edgeAlignmentSession?.sourceEdge
    ? 'Click a green IP, pixel-array, top-cell, or ruler reference'
    : edgeAlignmentSession && edgeAlignmentSession.sourceIds.length > 1
      ? 'Click an amber edge on any selected object'
      : `Click an amber edge of ${alignmentSourceName}`;

  const showToast = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(current => [...current, { id, message, kind }].slice(-3));
    window.setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), 3200);
  }, []);

  useEffect(() => {
    setDraftGridSize(formatGridValue(gridSize, gridSize));
  }, [gridSize]);

  const commitGridSize = () => {
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
    const options: SkillExportOptions = {
      preserveExistingMasters,
      useIpWrappers,
      ...optionsOverride,
    };
    try {
      return generateSkillCode(topLibName, topCellName, topWidth, topHeight, masterCells, instances, gridSize, pixelArray, options);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to generate Cadence SKILL code.');
      return null;
    }
  };

  const handleExport = () => {
    const skillCode = createSkillCode();
    if (!skillCode) return;
    downloadSkillFile(`${topCellName}.il`, skillCode);
  };

  const handleExportCsv = () => {
    try {
      const csv = generateFloorplanCsv(currentSnapshot);
      const filename = `${topCellName}_floorplan.csv`;
      downloadCsvFile(filename, csv);
      showToast(`${filename} exported`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to export the CSV table.');
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
      alert('Unable to save the workspace in this browser. Check that site storage is available.');
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
      alert(error instanceof Error ? error.message : 'Unable to export the SVG floorplan.');
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
      if (showCodePreview) setShowCodePreview(false);
      else if (showSummary) setShowSummary(false);
      else if (showConfig) setShowConfig(false);
    };
    window.addEventListener('keydown', closeModalsOnEscape);
    return () => window.removeEventListener('keydown', closeModalsOnEscape);
  }, [showCodePreview, showSummary, showConfig]);

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
      } catch {
        alert('Invalid SVG project. Please choose an SVG exported from this tool.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleAlignment = (action: AlignmentAction) => {
    try {
      if (action === 'distribute-horizontal') distributeSelectedInstances('horizontal');
      else if (action === 'distribute-vertical') distributeSelectedInstances('vertical');
      else alignSelectedInstances(action);
      showToast(`Applied ${action.replaceAll('-', ' ')}`, 'info');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to arrange the selected blocks.');
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
    setShowConfig(true);
  };

  const handleSaveConfig = () => {
    const width = Number.parseFloat(tempW);
    const height = Number.parseFloat(tempH);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      showToast('Top-cell width and height must be positive numbers.', 'error');
      return;
    }
    try {
      setTopDimensions(width, height);
      setShowConfig(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to resize the top cell.', 'error');
    }
  };

  return (
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
            <FiMousePointer /> Select
          </button>
          <button 
            className={`mode-btn ${appMode === 'measure' ? 'active' : ''}`}
            onClick={() => setAppMode('measure')}
            title="Measure Distance (K)"
          >
            <FiMinimize2 /> Ruler
          </button>
          {appMode === 'measure' && (
            <>
              <button
                className={`mode-btn${orthogonalRuler ? ' active' : ''}`}
                onClick={toggleOrthogonalRuler}
                title="Lock rulers perpendicular to matching IP edges (O)"
                aria-pressed={orthogonalRuler}
              >
                <FiGrid /> Ortho {orthogonalRuler ? 'ON' : 'OFF'}
              </button>
              <button
                className="mode-btn mode-btn--danger"
                onClick={() => clearRulers()}
                title="Clear Rulers"
              >
                <FiTrash2 /> Clear Rulers
              </button>
            </>
          )}
          <button
            className={`mode-btn mode-btn--autodim${showAutoDim ? ' active' : ''}`}
            onClick={toggleAutoDim}
            title="Auto-Dimension: show a nearest-gap overview, then select one IP to focus only its local gaps."
          >
            <FiGrid /> Auto-Dim
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
              Spacing
              <input
                type="text"
                inputMode="decimal"
                value={edgeAlignmentSession.offset}
                onChange={event => setEdgeAlignmentOffset(event.target.value)}
                onKeyDown={event => { if (event.key === 'Escape') cancelEdgeAlignment(); }}
                aria-label="Alignment spacing in micrometers"
              />
              <span>µm</span>
            </label>
            <span className="topbar-align__hint">Directional edge distance · the entire selection shifts together</span>
            <button className="topbar-align__cancel" type="button" onClick={cancelEdgeAlignment} aria-label="Cancel edge alignment" title="Cancel alignment (Esc)">
              <FiX />
            </button>
          </div>
        ) : <>
          <EditingToolbar
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          selectionCount={pixelArraySelected ? 1 : selectedInstanceIds.length}
          anchorName={pixelArraySelected ? 'Pixel Array' : instances.find(instance => instance.id === selectedInstanceId)?.name}
          onUndo={undo}
          onRedo={redo}
          onAlign={handleAlignment}
          onStartEdgeAlign={() => {
            setAppMode('select');
            if (pixelArraySelected) startEdgeAlignment(PIXEL_ARRAY_ALIGNMENT_ID);
            else if (selectedInstanceId) startEdgeAlignment(selectedInstanceId);
          }}
        />

        <button className={`btn btn-primary save-btn${isDirty ? ' has-unsaved' : ''}`} onClick={handleSaveWorkspace} title={`Save the editable workspace in this browser (Ctrl/Cmd+S) · ${saveStatus}`}>
          <FiSave /> Save
          <span className={`save-status ${isDirty ? 'dirty' : savedSignature === null ? 'new' : ''}`}>{saveStatus}</span>
        </button>
        <label className="btn file-open-btn" title="Import an editable SVG project">
          <FiUpload /> Import SVG
          <input type="file" accept=".svg,image/svg+xml" onChange={handleLoadProject} />
        </label>
        <button className="btn export-svg-btn" onClick={handleExportSvg} title="Export a visual SVG with editable project data embedded">
          <FiDownload /> Export SVG
        </button>
        <div className="vertical-divider" />

        <button className="btn config-btn" onClick={openConfigModal}>
          <FiSettings /> {topCellName} ({topWidth}x{topHeight})
        </button>
        <div className="grid-settings">
          <label>Grid (um):</label>
          <input 
            type="number" 
            min="0.000000000001"
            step="any"
            value={draftGridSize} 
            onChange={event => setDraftGridSize(event.target.value)}
            onBlur={commitGridSize}
            onKeyDown={event => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                setDraftGridSize(formatGridValue(gridSize, gridSize));
                event.currentTarget.blur();
              }
            }}
            className="input-field grid-input"
            title="Changing the grid re-snaps every instance to an exact grid multiple"
          />
        </div>
        <div className="vertical-divider vertical-divider--compact" />
        <button
          className={`btn metrics-btn${metrics.overlaps.length > 0 ? ' metrics-btn--alert' : ''}`}
          onClick={() => setShowSummary(true)}
          title={metrics.overlaps.length > 0
            ? `${metrics.overlaps.length} overlap violation${metrics.overlaps.length === 1 ? '' : 's'} detected — click to inspect summary & DRC`
            : 'Floorplan area metrics, DRC status, and CSV export'}
        >
          {metrics.overlaps.length > 0 ? (
            <><FiAlertTriangle /> {metrics.overlaps.length} Overlap{metrics.overlaps.length === 1 ? '' : 's'}</>
          ) : (
            <><FiBarChart2 /> Summary</>
          )}
        </button>
        <button className="btn shortcuts-btn" onClick={() => setShowTutorial(true)}>
          <FiBookOpen /> Help
        </button>
        <button className="btn btn-primary preview-btn" onClick={handlePreview}>
          <FiCode /> Preview Code
        </button>
        </>}
      </div>

      {showConfig && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel config-modal">
            <div className="modal-header">
              <h2 className="modal-title">Configure Top ASIC</h2>
              <button className="modal-close-btn" onClick={() => setShowConfig(false)}>
                <FiX />
              </button>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="label">Width (um)</label>
                <input type="number" className="input-field" value={tempW} onChange={e => setTempW(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="label">Height (um)</label>
                <input type="number" className="input-field" value={tempH} onChange={e => setTempH(e.target.value)} />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowConfig(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveConfig}>Save</button>
            </div>
          </div>
        </div>
      )}

      {showTutorial && (
        <TutorialModal onClose={closeTutorial} onLoadDemo={handleLoadDemo} />
      )}
      
      {showSummary && (
        <div className="modal-overlay">
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
                  {metrics.overlaps.length === 0 ? (
                    <span className="drc-status drc-status--clean"><FiCheckCircle /> No instance overlaps detected</span>
                  ) : (
                    <span className="drc-status drc-status--error"><FiAlertTriangle /> {metrics.overlaps.length} overlap violation{metrics.overlaps.length === 1 ? '' : 's'}</span>
                  )}
                </h3>
                <label className="drc-toggle">
                  <input type="checkbox" checked={showOverlapDrc} onChange={toggleOverlapDrc} />
                  Highlight overlaps on canvas
                </label>
              </div>
              {metrics.overlaps.length > 0 && (
                <ul className="drc-list">
                  {metrics.overlaps.map(violation => (
                    <li key={violation.id}>
                      <button
                        type="button"
                        className="drc-item"
                        onClick={() => {
                          setSelection([violation.idA, violation.idB]);
                          setShowSummary(false);
                        }}
                      >
                        <span className="drc-item__names">
                          <strong>{violation.nameA}</strong> ↔ <strong>{violation.nameB}</strong>
                        </span>
                        <span className="drc-item__meta">
                          <span className="drc-kind-badge">{violation.kind.toUpperCase()}</span>
                          {formatGridValue(violation.width, gridSize)} × {formatGridValue(violation.height, gridSize)} µm ({violation.areaUm2.toFixed(2)} µm²)
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
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
        <div className="modal-overlay">
          <div className="modal-content glass-panel code-preview-modal">
            <div className="modal-header">
              <h2 className="modal-title">SKILL Code Preview</h2>
              <button className="modal-close-btn" onClick={() => setShowCodePreview(false)}>
                <FiX />
              </button>
            </div>
            <div className="skill-options-bar">
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
                <span>Preserve existing masters (skip overwrite if cellview exists)</span>
              </label>
              <label className="skill-option-toggle">
                <input
                  type="checkbox"
                  checked={useIpWrappers}
                  onChange={event => {
                    const next = event.target.checked;
                    setUseIpWrappers(next);
                    const updated = createSkillCode({ useIpWrappers: next });
                    if (updated) setGeneratedCode(updated);
                  }}
                />
                <span>Use origin-anchored IP wrappers</span>
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
      <ToastViewport messages={toasts} onDismiss={id => setToasts(current => current.filter(toast => toast.id !== id))} />
    </div>
  );
};
