import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { generateSkillCode, downloadSkillFile } from '../utils/skillExport';
import { FiDownload, FiSettings, FiMousePointer, FiMinimize2, FiTrash2, FiCode, FiCopy, FiUpload, FiX, FiBookOpen } from 'react-icons/fi';
import { TutorialModal } from './TutorialModal';
import './Topbar.css';

export const Topbar: React.FC = () => {
  const { appMode, setAppMode, topWidth, topHeight, setTopDimensions, masterCells, instances, gridSize, setGridSize, clearRulers } = useStore();
  const [showConfig, setShowConfig] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [tempW, setTempW] = useState(topWidth.toString());
  const [tempH, setTempH] = useState(topHeight.toString());
  
  const [showCodePreview, setShowCodePreview] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');

  const handleExport = () => {
    const skillCode = generateSkillCode(topWidth, topHeight, masterCells, instances);
    downloadSkillFile(`top_asic.il`, skillCode);
  };
  
  const handlePreview = () => {
    const code = generateSkillCode(topWidth, topHeight, masterCells, instances);
    setGeneratedCode(code);
    setShowCodePreview(true);
  };

  const handleLoadProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      try {
        let jsonData = null;
        if (text.includes('<metadata class="floorplan-data">')) {
          const match = text.match(/<!\[CDATA\[(.*?)\]\]>/s);
          if (match && match[1]) {
            jsonData = JSON.parse(match[1]);
          }
        } else {
          // fallback to standard json parsing
          jsonData = JSON.parse(text);
        }
        
        if (jsonData) {
          useStore.getState().loadProject(jsonData);
        } else {
          throw new Error("No valid data found");
        }
      } catch (err) {
        alert('Invalid project or SVG file format. Please ensure it was exported from this tool.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
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
              className="mode-btn"
              onClick={() => clearRulers()}
              title="Clear Rulers"
              style={{ color: '#ef4444' }}
            >
              <FiTrash2 /> Clear Rulers
            </button>
          )}
        </div>
      </div>

      <div className="topbar-right">
        <label className="btn" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }} title="Import SVG or .flp Project">
          <FiUpload /> Import SVG
          <input type="file" accept=".svg,.flp,.json" style={{ display: 'none' }} onChange={handleLoadProject} />
        </label>
        
        <div className="vertical-divider" style={{ width: '1px', height: '24px', backgroundColor: 'var(--border-color)', margin: '0 8px' }}></div>

        <button className="btn config-btn" onClick={() => setShowConfig(true)}>
          <FiSettings /> top_asic ({topWidth}x{topHeight})
        </button>
        <div className="grid-settings">
          <label>Grid (um):</label>
          <input 
            type="number" 
            step="0.001" 
            value={gridSize} 
            onChange={e => setGridSize(parseFloat(e.target.value) || 0.001)}
            className="input-field grid-input"
          />
        </div>
        <div className="vertical-divider" style={{ width: '1px', height: '24px', backgroundColor: 'var(--border-color)', margin: '0 4px' }}></div>
        <button className="btn" onClick={() => setShowTutorial(true)} style={{ backgroundColor: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
          <FiBookOpen /> Shortcuts
        </button>
        <button className="btn btn-primary preview-btn" onClick={handlePreview}>
          <FiCode /> Preview Code
        </button>
      </div>

      {showConfig && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel" style={{ zIndex: 100 }}>
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
        <TutorialModal onClose={() => setShowTutorial(false)} />
      )}
      
      {showCodePreview && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel code-preview-modal" style={{ zIndex: 100, width: '80%', maxWidth: '800px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header">
              <h2 className="modal-title">SKILL Code Preview</h2>
              <button className="modal-close-btn" onClick={() => setShowCodePreview(false)}>
                <FiX />
              </button>
            </div>
            <div className="code-container" style={{ flex: 1, overflow: 'auto', backgroundColor: '#0f172a', padding: '16px', borderRadius: '8px', border: '1px solid #334155' }}>
              <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '13px', color: '#38bdf8', whiteSpace: 'pre-wrap' }}>
                {generatedCode}
              </pre>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowCodePreview(false)}>Close</button>
              <button className="btn" onClick={() => { 
                navigator.clipboard.writeText(generatedCode);
                // Can use a lightweight notification or just rely on native OS toast
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
    </div>
  );
};
