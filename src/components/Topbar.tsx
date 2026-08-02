import React, { useEffect, useState } from 'react';
import { getProjectSnapshot, useStore } from '../store/useStore';
import { generateSkillCode, downloadSkillFile } from '../utils/skillExport';
import { exportSVG } from '../utils/svgExport';
import { parseProjectDocument, serializeProjectDocument } from '../store/projectDocument';
import { FiDownload, FiSettings, FiMousePointer, FiMinimize2, FiTrash2, FiCode, FiCopy, FiUpload, FiX, FiBookOpen, FiGrid, FiSave } from 'react-icons/fi';
import { TutorialModal } from './TutorialModal';
import { EditingToolbar } from './EditingToolbar';
import type { AlignmentAction } from './EditingToolbar';
import { ToastViewport } from './ToastViewport';
import type { ToastKind, ToastMessage } from './ToastViewport';
import './Topbar.css';

export const Topbar: React.FC = () => {
  const { appMode, setAppMode, topWidth, topHeight, topLibName, topCellName, setTopDimensions, masterCells, instances, gridSize, setGridSize, clearRulers, showAutoDim, toggleAutoDim, history, selectedInstanceId, selectedInstanceIds, undo, redo, alignSelectedInstances, distributeSelectedInstances, startEdgeAlignment, edgeAlignmentSession, setEdgeAlignmentOffset, cancelEdgeAlignment } = useStore();
  const [showConfig, setShowConfig] = useState(false);
  const [showTutorial, setShowTutorial] = useState(() => {
    try {
      return localStorage.getItem('ic-floorplanner:tutorial-seen:v8') !== 'yes';
    } catch {
      return true;
    }
  });
  const [tempW, setTempW] = useState(topWidth.toString());
  const [tempH, setTempH] = useState(topHeight.toString());
  
  const [showCodePreview, setShowCodePreview] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const projectSignature = JSON.stringify(getProjectSnapshot(useStore.getState()));
  const isDirty = savedSignature === null ? history.past.length > 0 : projectSignature !== savedSignature;
  const saveStatus = isDirty ? 'Unsaved' : savedSignature === null ? 'Not saved' : 'Saved';
  const alignmentSource = edgeAlignmentSession
    ? instances.find(instance => instance.id === edgeAlignmentSession.sourceId)
    : null;
  const alignmentAxis = edgeAlignmentSession?.sourceEdge
    ? (edgeAlignmentSession.sourceEdge === 'left' || edgeAlignmentSession.sourceEdge === 'right' || edgeAlignmentSession.sourceEdge === 'horizontal-center'
        ? 'horizontally'
        : 'vertically')
    : null;
  const alignmentStep = edgeAlignmentSession?.sourceEdge
    ? 'Click the green side where this IP should be placed'
    : `Click an amber edge of ${alignmentSource?.name ?? 'the source IP'}`;

  const showToast = (message: string, kind: ToastKind = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(current => [...current, { id, message, kind }].slice(-3));
    window.setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), 3200);
  };

  const createSkillCode = () => {
    try {
      return generateSkillCode(topLibName, topCellName, topWidth, topHeight, masterCells, instances, gridSize);
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

  const handleDownloadProject = () => {
    const snapshot = getProjectSnapshot(useStore.getState());
    const blob = new Blob([serializeProjectDocument(snapshot)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${snapshot.topCellName}.flp`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setSavedSignature(JSON.stringify(snapshot));
    showToast(`${snapshot.topCellName}.flp backup downloaded`);
  };

  const handleSaveSvg = () => {
    try {
      const filename = exportSVG();
      const snapshot = getProjectSnapshot(useStore.getState());
      setSavedSignature(JSON.stringify(snapshot));
      showToast(`${filename} saved — open it in any browser`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to save the SVG floorplan.');
    }
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        handleSaveSvg();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  });

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
        let jsonData = null;
        if (text.includes('<metadata class="floorplan-data">')) {
          const match = text.match(/<!\[CDATA\[(.*?)\]\]>/s);
          if (match && match[1]) {
            jsonData = parseProjectDocument(match[1]);
          }
        } else {
          jsonData = parseProjectDocument(text);
        }
        
        if (jsonData) {
          useStore.getState().loadProject(jsonData);
          setSavedSignature(JSON.stringify(getProjectSnapshot(useStore.getState())));
          showToast(`${jsonData.topCellName} opened`);
        } else {
          throw new Error("No valid data found");
        }
      } catch {
        alert('Invalid project or SVG file format. Please ensure it was exported from this tool.');
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
      localStorage.setItem('ic-floorplanner:tutorial-seen:v8', 'yes');
    } catch {
      // The tutorial still closes when browser storage is unavailable.
    }
  };

  const handleSaveConfig = () => {
    setTopDimensions(parseFloat(tempW) || 100, parseFloat(tempH) || 100);
    setShowConfig(false);
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
            title="Select & Move (V)"
          >
            <FiMousePointer /> Select
          </button>
          <button 
            className={`mode-btn ${appMode === 'measure' ? 'active' : ''}`}
            onClick={() => setAppMode('measure')}
            title="Measure Distance (M)"
          >
            <FiMinimize2 /> Ruler
          </button>
          {appMode === 'measure' && (
            <button 
              className="mode-btn mode-btn--danger"
              onClick={() => clearRulers()}
              title="Clear Rulers"
            >
              <FiTrash2 /> Clear Rulers
            </button>
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
                <strong>{alignmentAxis ? `Move ${alignmentSource?.name ?? 'IP'} ${alignmentAxis}` : `Align ${alignmentSource?.name ?? 'IP'}`}</strong>
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
            <span className="topbar-align__hint">Non-negative gap outside target · inside top boundary</span>
            <button className="topbar-align__cancel" type="button" onClick={cancelEdgeAlignment} aria-label="Cancel edge alignment" title="Cancel alignment (Esc)">
              <FiX />
            </button>
          </div>
        ) : <>
          <EditingToolbar
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          selectionCount={selectedInstanceIds.length}
          anchorName={instances.find(instance => instance.id === selectedInstanceId)?.name}
          onUndo={undo}
          onRedo={redo}
          onAlign={handleAlignment}
          onStartEdgeAlign={() => {
            if (!selectedInstanceId) return;
            setAppMode('select');
            startEdgeAlignment(selectedInstanceId);
          }}
        />

        <button className="btn btn-primary save-svg-btn" onClick={handleSaveSvg} title="Save an editable SVG you can inspect in any browser (Ctrl/Cmd+S)">
          <FiSave /> Save SVG
          <span className={`save-status ${isDirty ? 'dirty' : savedSignature === null ? 'new' : ''}`}>{saveStatus}</span>
        </button>
        <label className="btn file-open-btn" title="Open an SVG, .flp, or legacy JSON project">
          <FiUpload /> Open Project
          <input type="file" accept=".svg,.flp,.json" onChange={handleLoadProject} />
        </label>
        <button className="btn backup-btn" onClick={handleDownloadProject} title="Download a compact editable .flp backup">
          <FiDownload /> <span>Backup .flp</span>
        </button>
        
        <div className="vertical-divider" />

        <button className="btn config-btn" onClick={() => setShowConfig(true)}>
          <FiSettings /> {topCellName} ({topWidth}x{topHeight})
        </button>
        <div className="grid-settings">
          <label>Grid (um):</label>
          <input 
            type="number" 
            min="0.000000000001"
            step="any"
            value={gridSize} 
            onChange={event => {
              const size = Number(event.target.value);
              if (Number.isFinite(size) && size > 0) setGridSize(size);
            }}
            className="input-field grid-input"
            title="Changing the grid re-snaps every instance to an exact grid multiple"
          />
        </div>
        <div className="vertical-divider vertical-divider--compact" />
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
        <TutorialModal onClose={closeTutorial} />
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
