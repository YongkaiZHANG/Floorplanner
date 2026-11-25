import React from 'react';
import { PIXEL_ARRAY_ALIGNMENT_ID, rotateOrientationByQuarterTurns, useStore } from '../store/useStore';
import { FiInfo, FiTrash2, FiPaperclip, FiSliders, FiRotateCcw, FiRotateCw, FiEye, FiEyeOff, FiLock, FiUnlock, FiCornerDownRight, FiExternalLink, FiCrosshair, FiGrid, FiAlignCenter } from 'react-icons/fi';
import './PropertiesPanel.css';
import { formatGridValue } from '../utils/grid';
import { findBoundaryViolations, findOverlapViolations } from '../utils/floorplanMetrics';
import {
  formatLppLabel,
  LAYOUT_TEXT_FONT_FAMILIES,
  LAYOUT_TEXT_FONT_STYLES,
  resolveLayerStyle,
  VIRTUOSO_LAYER_PRESETS,
} from '../utils/layoutLayers';
import type { LayoutTextFontFamily, LayoutTextFontStyle } from '../utils/layoutLayers';
import { getPhysicalBounds, isActiveMosaic } from '../utils/alignment';
import type { CadenceOrientation } from '../utils/alignment';

const ORIENTATIONS = ['R0', 'R90', 'R180', 'R270', 'MX', 'MY', 'MXR90', 'MYR90'];

export const PropertiesPanel: React.FC = () => {
  const {
    activeCellId,
    topWidth,
    topHeight,
    topCellName,
    masterCells,
    instances,
    shapes,
    cellViews,
    descendIntoInstance,
    openCellView,
    gridSize,
    selectedInstanceId,
    selectedInstanceIds,
    selectedShapeId,
    updateInstancePosition,
    renameInstance,
    toggleInstanceLock,
    updateInstanceOrientation,
    updateInstanceMosaic,
    flattenMosaicInstance,
    deleteSelectedInstances,
    updateShape,
    deleteShape,
    toggleShapeLock,
    pixelArray,
    pixelArraySelected,
    updatePixelArrayGeometry,
    centerPixelArray,
    setPixelArrayVisible,
    deletePixelArray,
    startEdgeAlignment,
    setAppMode,
    rightSidebarPinned,
    setRightSidebarPinned,
    pushToast,
  } = useStore();
  const [isHovered, setIsHovered] = React.useState(false);
  const [isFocusWithin, setIsFocusWithin] = React.useState(false);
  const hoverTimeout = React.useRef<number | null>(null);
  const notifyError = (error: unknown, fallback: string) => {
    pushToast(error instanceof Error ? error.message : fallback, 'error');
  };
  
  const selectedInstance = instances.find(inst => inst.id === selectedInstanceId);
  const selectedShape = shapes.find(shape => shape.id === selectedShapeId) ?? null;
  const masterCell = selectedInstance ? masterCells[selectedInstance.cellId] : null;
  const selectedBoundaryViolation = React.useMemo(() => {
    if (activeCellId !== null || !selectedInstance) return null;
    return findBoundaryViolations({
      topWidth,
      topHeight,
      masterCells,
      instances: [selectedInstance],
    })[0] ?? null;
  }, [activeCellId, selectedInstance, topWidth, topHeight, masterCells]);
  const selectedOverlapNames = React.useMemo(() => {
    if (!selectedInstance) return [] as string[];
    return findOverlapViolations({ masterCells, instances })
      .filter(v => v.idA === selectedInstance.id || v.idB === selectedInstance.id)
      .map(v => (v.idA === selectedInstance.id ? v.nameB : v.nameA));
  }, [selectedInstance, masterCells, instances]);
  const [draftName, setDraftName] = React.useState('');
  const [draftX, setDraftX] = React.useState('0');
  const [draftY, setDraftY] = React.useState('0');
  const [draftMosaicRows, setDraftMosaicRows] = React.useState('1');
  const [draftMosaicCols, setDraftMosaicCols] = React.useState('1');
  const [draftMosaicColPitch, setDraftMosaicColPitch] = React.useState('0');
  const [draftMosaicRowPitch, setDraftMosaicRowPitch] = React.useState('0');

  const [draftArrayX, setDraftArrayX] = React.useState('0');
  const [draftArrayY, setDraftArrayY] = React.useState('0');
  const [draftArrayCx, setDraftArrayCx] = React.useState('0');
  const [draftArrayCy, setDraftArrayCy] = React.useState('0');
  const [draftArrayW, setDraftArrayW] = React.useState('0');
  const [draftArrayH, setDraftArrayH] = React.useState('0');
  const [draftMarginL, setDraftMarginL] = React.useState('0');
  const [draftMarginR, setDraftMarginR] = React.useState('0');
  const [draftMarginB, setDraftMarginB] = React.useState('0');
  const [draftMarginT, setDraftMarginT] = React.useState('0');

  const containerOriginX = activeCellId ? (masterCells[activeCellId]?.originX ?? 0) : -topWidth / 2;
  const containerOriginY = activeCellId ? (masterCells[activeCellId]?.originY ?? 0) : -topHeight / 2;
  const containerMaxX = containerOriginX + topWidth;
  const containerMaxY = containerOriginY + topHeight;

  const [draftShapeLayer, setDraftShapeLayer] = React.useState('text');
  const [draftShapePurpose, setDraftShapePurpose] = React.useState('drawing');
  const [draftShapeLabel, setDraftShapeLabel] = React.useState('');
  const [draftShapeFontSize, setDraftShapeFontSize] = React.useState('20');
  const [draftShapeX1, setDraftShapeX1] = React.useState('0');
  const [draftShapeY1, setDraftShapeY1] = React.useState('0');
  const [draftShapeX2, setDraftShapeX2] = React.useState('0');
  const [draftShapeY2, setDraftShapeY2] = React.useState('0');

  React.useEffect(() => {
    if (!selectedInstance) return;
    setDraftName(selectedInstance.name);
    setDraftX(formatGridValue(selectedInstance.x, gridSize));
    setDraftY(formatGridValue(selectedInstance.y, gridSize));
    const cell = masterCells[selectedInstance.cellId];
    const m = selectedInstance.mosaic;
    setDraftMosaicRows(String(m?.rows ?? 1));
    setDraftMosaicCols(String(m?.cols ?? 1));
    setDraftMosaicColPitch(formatGridValue(m ? m.colPitch : (cell?.width ?? 0), gridSize));
    setDraftMosaicRowPitch(formatGridValue(m ? m.rowPitch : (cell?.height ?? 0), gridSize));
  }, [selectedInstance, masterCells, gridSize]);

  React.useEffect(() => {
    if (!selectedShape) return;
    setDraftShapeLayer(selectedShape.layer);
    setDraftShapePurpose(selectedShape.purpose);
    setDraftShapeLabel(selectedShape.label ?? '');
    setDraftShapeFontSize(formatGridValue(selectedShape.fontSize ?? selectedShape.height, gridSize));
    setDraftShapeX1(formatGridValue(selectedShape.x, gridSize));
    setDraftShapeY1(formatGridValue(selectedShape.y, gridSize));
    setDraftShapeX2(formatGridValue(selectedShape.x + selectedShape.width, gridSize));
    setDraftShapeY2(formatGridValue(selectedShape.y + selectedShape.height, gridSize));
  }, [selectedShape, gridSize]);

  const syncPixelArrayDrafts = React.useCallback((pa: NonNullable<typeof pixelArray>) => {
    setDraftArrayX(formatGridValue(pa.x, gridSize));
    setDraftArrayY(formatGridValue(pa.y, gridSize));
    setDraftArrayCx(formatGridValue(pa.x + pa.width / 2, gridSize));
    setDraftArrayCy(formatGridValue(pa.y + pa.height / 2, gridSize));
    setDraftArrayW(formatGridValue(pa.width, gridSize));
    setDraftArrayH(formatGridValue(pa.height, gridSize));
    setDraftMarginL(formatGridValue(pa.x - containerOriginX, gridSize));
    setDraftMarginR(formatGridValue(containerMaxX - (pa.x + pa.width), gridSize));
    setDraftMarginB(formatGridValue(pa.y - containerOriginY, gridSize));
    setDraftMarginT(formatGridValue(containerMaxY - (pa.y + pa.height), gridSize));
  }, [gridSize, containerOriginX, containerOriginY, containerMaxX, containerMaxY]);

  React.useEffect(() => {
    if (!pixelArray) return;
    syncPixelArrayDrafts(pixelArray);
  }, [pixelArray, syncPixelArrayDrafts]);

  const skipNextBlurCommitRef = React.useRef(false);

  const commitInstanceName = () => {
    if (skipNextBlurCommitRef.current) {
      skipNextBlurCommitRef.current = false;
      return;
    }
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
      notifyError(error, 'Unable to rename the selected instance.');
    }
  };

  const commitPosition = (axis: 'x' | 'y') => {
    if (skipNextBlurCommitRef.current) {
      skipNextBlurCommitRef.current = false;
      return;
    }
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
      notifyError(error, 'Unable to move the selected instance.');
    }
  };

  type PixelArrayField = 'x' | 'y' | 'cx' | 'cy' | 'width' | 'height' | 'marginL' | 'marginR' | 'marginB' | 'marginT';

  const commitPixelArrayField = (field: PixelArrayField) => {
    if (skipNextBlurCommitRef.current) {
      skipNextBlurCommitRef.current = false;
      return;
    }
    if (!pixelArray) return;
    const rawMap: Record<PixelArrayField, string> = {
      x: draftArrayX,
      y: draftArrayY,
      cx: draftArrayCx,
      cy: draftArrayCy,
      width: draftArrayW,
      height: draftArrayH,
      marginL: draftMarginL,
      marginR: draftMarginR,
      marginB: draftMarginB,
      marginT: draftMarginT,
    };
    const value = Number.parseFloat(rawMap[field]);
    if (!Number.isFinite(value)) {
      syncPixelArrayDrafts(pixelArray);
      return;
    }
    const curCx = pixelArray.x + pixelArray.width / 2;
    const curCy = pixelArray.y + pixelArray.height / 2;
    let nextX = pixelArray.x;
    let nextY = pixelArray.y;
    let nextW = pixelArray.width;
    let nextH = pixelArray.height;

    if (field === 'x') {
      nextX = value;
    } else if (field === 'y') {
      nextY = value;
    } else if (field === 'cx') {
      nextX = value - pixelArray.width / 2;
    } else if (field === 'cy') {
      nextY = value - pixelArray.height / 2;
    } else if (field === 'width') {
      nextW = value;
      nextX = curCx - value / 2;
    } else if (field === 'height') {
      nextH = value;
      nextY = curCy - value / 2;
    } else if (field === 'marginL') {
      nextX = containerOriginX + value;
    } else if (field === 'marginR') {
      nextX = containerMaxX - pixelArray.width - value;
    } else if (field === 'marginB') {
      nextY = containerOriginY + value;
    } else if (field === 'marginT') {
      nextY = containerMaxY - pixelArray.height - value;
    }

    try {
      updatePixelArrayGeometry(nextX, nextY, nextW, nextH);
      const updated = useStore.getState().pixelArray;
      if (updated) syncPixelArrayDrafts(updated);
    } catch (error) {
      syncPixelArrayDrafts(pixelArray);
      notifyError(error, 'Unable to update the pixel array.');
    }
  };

  const commitMosaic = () => {
    if (skipNextBlurCommitRef.current) {
      skipNextBlurCommitRef.current = false;
      return;
    }
    if (!selectedInstance || !masterCell) return;
    const rows = Math.floor(Number.parseFloat(draftMosaicRows));
    const cols = Math.floor(Number.parseFloat(draftMosaicCols));
    const colPitch = Number.parseFloat(draftMosaicColPitch);
    const rowPitch = Number.parseFloat(draftMosaicRowPitch);
    const resetDrafts = () => {
      const m = selectedInstance.mosaic;
      setDraftMosaicRows(String(m?.rows ?? 1));
      setDraftMosaicCols(String(m?.cols ?? 1));
      setDraftMosaicColPitch(formatGridValue(m ? m.colPitch : masterCell.width, gridSize));
      setDraftMosaicRowPitch(formatGridValue(m ? m.rowPitch : masterCell.height, gridSize));
    };
    if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows < 1 || cols < 1 || !Number.isFinite(colPitch) || !Number.isFinite(rowPitch)) {
      resetDrafts();
      return;
    }
    const cur = selectedInstance.mosaic;
    const unchanged = rows === (cur?.rows ?? 1)
      && cols === (cur?.cols ?? 1)
      && (rows === 1 && cols === 1
        ? !cur
        : Math.abs(colPitch - (cur?.colPitch ?? masterCell.width)) <= 1e-9
          && Math.abs(rowPitch - (cur?.rowPitch ?? masterCell.height)) <= 1e-9);
    if (unchanged) {
      resetDrafts();
      return;
    }
    try {
      updateInstanceMosaic(
        selectedInstance.id,
        rows === 1 && cols === 1 ? null : { rows, cols, rowPitch, colPitch },
      );
    } catch (error) {
      resetDrafts();
      notifyError(error, 'Unable to update mosaic array.');
    }
  };

  const handleMosaicKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape' && selectedInstance && masterCell) {
      skipNextBlurCommitRef.current = true;
      const m = selectedInstance.mosaic;
      setDraftMosaicRows(String(m?.rows ?? 1));
      setDraftMosaicCols(String(m?.cols ?? 1));
      setDraftMosaicColPitch(formatGridValue(m ? m.colPitch : masterCell.width, gridSize));
      setDraftMosaicRowPitch(formatGridValue(m ? m.rowPitch : masterCell.height, gridSize));
      event.currentTarget.blur();
    }
  };

  const applyOrientation = (orientation: string) => {
    if (!selectedInstance) return;
    try {
      updateInstanceOrientation(selectedInstance.id, orientation);
    } catch (error) {
      notifyError(error, 'Unable to orient the selected instance.');
    }
  };

  React.useEffect(() => () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
  }, []);

  const handlePositionKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, axis: 'x' | 'y') => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape' && selectedInstance) {
      skipNextBlurCommitRef.current = true;
      if (axis === 'x') setDraftX(formatGridValue(selectedInstance.x, gridSize));
      else setDraftY(formatGridValue(selectedInstance.y, gridSize));
      event.currentTarget.blur();
    }
  };

  const handlePixelArrayKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape' && pixelArray) {
      skipNextBlurCommitRef.current = true;
      syncPixelArrayDrafts(pixelArray);
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

  const commitShapeMeta = () => {
    if (skipNextBlurCommitRef.current) {
      skipNextBlurCommitRef.current = false;
      return;
    }
    if (!selectedShape) return;
    try {
      updateShape(selectedShape.id, {
        layer: draftShapeLayer.trim() || selectedShape.layer,
        purpose: draftShapePurpose.trim() || selectedShape.purpose,
        label: selectedShape.kind === 'text'
          ? (draftShapeLabel.trim() || selectedShape.label || 'LABEL')
          : draftShapeLabel,
      });
    } catch (error) {
      setDraftShapeLabel(selectedShape.label ?? '');
      notifyError(error, 'Unable to update shape layer/purpose.');
    }
  };

  const commitTextGeometry = () => {
    if (skipNextBlurCommitRef.current) {
      skipNextBlurCommitRef.current = false;
      return;
    }
    if (!selectedShape || selectedShape.kind !== 'text') return;
    const nextX = Number.parseFloat(draftShapeX1);
    const nextY = Number.parseFloat(draftShapeY1);
    const nextFontSize = Number.parseFloat(draftShapeFontSize);
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY) || !Number.isFinite(nextFontSize) || nextFontSize <= 0) {
      setDraftShapeX1(formatGridValue(selectedShape.x, gridSize));
      setDraftShapeY1(formatGridValue(selectedShape.y, gridSize));
      setDraftShapeFontSize(formatGridValue(selectedShape.fontSize ?? selectedShape.height, gridSize));
      return;
    }
    try {
      updateShape(selectedShape.id, {
        x: nextX,
        y: nextY,
        fontSize: nextFontSize,
      });
    } catch (error) {
      setDraftShapeX1(formatGridValue(selectedShape.x, gridSize));
      setDraftShapeY1(formatGridValue(selectedShape.y, gridSize));
      setDraftShapeFontSize(formatGridValue(selectedShape.fontSize ?? selectedShape.height, gridSize));
      notifyError(error, 'Unable to update text label.');
    }
  };

  const commitShapeBox = () => {
    if (skipNextBlurCommitRef.current) {
      skipNextBlurCommitRef.current = false;
      return;
    }
    if (!selectedShape) return;
    const x1 = Number.parseFloat(draftShapeX1);
    const y1 = Number.parseFloat(draftShapeY1);
    const x2 = Number.parseFloat(draftShapeX2);
    const y2 = Number.parseFloat(draftShapeY2);
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
      setDraftShapeX1(formatGridValue(selectedShape.x, gridSize));
      setDraftShapeY1(formatGridValue(selectedShape.y, gridSize));
      setDraftShapeX2(formatGridValue(selectedShape.x + selectedShape.width, gridSize));
      setDraftShapeY2(formatGridValue(selectedShape.y + selectedShape.height, gridSize));
      return;
    }
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    try {
      updateShape(selectedShape.id, {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      });
    } catch (error) {
      setDraftShapeX1(formatGridValue(selectedShape.x, gridSize));
      setDraftShapeY1(formatGridValue(selectedShape.y, gridSize));
      setDraftShapeX2(formatGridValue(selectedShape.x + selectedShape.width, gridSize));
      setDraftShapeY2(formatGridValue(selectedShape.y + selectedShape.height, gridSize));
      notifyError(error, 'Unable to update shape coordinates.');
    }
  };

  const handleShapeMetaKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape' && selectedShape) {
      skipNextBlurCommitRef.current = true;
      setDraftShapeLayer(selectedShape.layer);
      setDraftShapePurpose(selectedShape.purpose);
      setDraftShapeLabel(selectedShape.label ?? '');
      event.currentTarget.blur();
    }
  };

  const handleShapeBoxKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape' && selectedShape) {
      skipNextBlurCommitRef.current = true;
      setDraftShapeX1(formatGridValue(selectedShape.x, gridSize));
      setDraftShapeY1(formatGridValue(selectedShape.y, gridSize));
      setDraftShapeX2(formatGridValue(selectedShape.x + selectedShape.width, gridSize));
      setDraftShapeY2(formatGridValue(selectedShape.y + selectedShape.height, gridSize));
      event.currentTarget.blur();
    }
  };

  const isOpen = rightSidebarPinned || isHovered || isFocusWithin;
  const showingPixelArray = !selectedInstance && !selectedShape && pixelArraySelected && Boolean(pixelArray);
  const showingShape = !selectedInstance && Boolean(selectedShape);

  const renderPinButton = () => (
    <button
      type="button"
      className={`panel-pin-btn${rightSidebarPinned ? ' pinned' : ''}`}
      onClick={() => setRightSidebarPinned(!rightSidebarPinned)}
      title={rightSidebarPinned ? 'Unpin Properties (float on hover)' : 'Pin & dock Properties panel (Q)'}
      aria-label={rightSidebarPinned ? 'Unpin Properties' : 'Pin Properties'}
      aria-pressed={rightSidebarPinned}
    >
      <FiPaperclip style={{ transform: rightSidebarPinned ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }} />
    </button>
  );

  return (
    <div 
      className={`properties-wrapper${rightSidebarPinned ? ' pinned' : ''}${!isOpen ? ' collapsed' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={() => setIsFocusWithin(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsFocusWithin(false);
        }
      }}
    >
      <button 
        type="button"
        className={`collapse-toggle right-toggle ${rightSidebarPinned ? 'pinned' : ''}`} 
        onClick={() => setRightSidebarPinned(!rightSidebarPinned)}
        title={rightSidebarPinned ? 'Unpin Properties' : 'Click to pin & dock Properties (Q) · hover to peek'}
        aria-label="Toggle Properties panel"
      >
        <FiSliders />
        <span className="collapse-toggle__label">Properties</span>
      </button>

      <div className="properties-panel glass-panel">
        {showingShape && selectedShape ? (
          <>
            <div className="panel-header">
              <div className="panel-header__top">
                <h3 className="section-title">{selectedShape.kind === 'text' ? 'Text Label' : 'Rectangle Shape'}</h3>
                {renderPinButton()}
              </div>
              <span className="selection-count">{formatLppLabel(selectedShape.layer, selectedShape.purpose)}</span>
            </div>

            <div className="prop-section">
              <h4 className="sub-title">Layer / Purpose (Virtuoso LPP)</h4>
              {selectedShape.locked && (
                <div className="locked-banner">
                  Locked — unlock (Shift+L) to edit or delete this {selectedShape.kind === 'text' ? 'text label' : 'shape'}.
                </div>
              )}
              {selectedShape.kind === 'text' && (
                <div className="form-group" style={{ marginBottom: '10px' }}>
                  <label className="label">Text Content</label>
                  <input
                    type="text"
                    className="input-field"
                    value={draftShapeLabel}
                    disabled={Boolean(selectedShape.locked)}
                    placeholder="e.g. VDD, PAD_IN"
                    onChange={e => setDraftShapeLabel(e.target.value)}
                    onBlur={commitShapeMeta}
                    onKeyDown={handleShapeMetaKeyDown}
                  />
                </div>
              )}
              <div className="form-group" style={{ marginBottom: '10px' }}>
                <label className="label">Preset LPP</label>
                <select
                  className="input-field"
                  disabled={Boolean(selectedShape.locked)}
                  value={(() => {
                    const matchedPreset = VIRTUOSO_LAYER_PRESETS.find(
                      p => p.layer.toLowerCase() === selectedShape.layer.toLowerCase()
                        && p.purpose.toLowerCase() === selectedShape.purpose.toLowerCase(),
                    );
                    return matchedPreset ? `${matchedPreset.layer}/${matchedPreset.purpose}` : '__custom__';
                  })()}
                  onChange={event => {
                    const value = event.target.value;
                    if (value === '__custom__') return;
                    const [layer, purpose] = value.split('/');
                    try {
                      updateShape(selectedShape.id, { layer, purpose, color: '' });
                    } catch (error) {
                      notifyError(error, 'Unable to change layer.');
                    }
                  }}
                >
                  {VIRTUOSO_LAYER_PRESETS.map(p => (
                    <option key={`${p.layer}/${p.purpose}`} value={`${p.layer}/${p.purpose}`}>
                      {formatLppLabel(p.layer, p.purpose)}
                    </option>
                  ))}
                  <option value="__custom__">Custom ({formatLppLabel(selectedShape.layer, selectedShape.purpose)})</option>
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="label">Layer</label>
                  <input
                    type="text"
                    className="input-field"
                    value={draftShapeLayer}
                    disabled={Boolean(selectedShape.locked)}
                    onChange={e => setDraftShapeLayer(e.target.value)}
                    onBlur={commitShapeMeta}
                    onKeyDown={handleShapeMetaKeyDown}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Purpose</label>
                  <input
                    type="text"
                    className="input-field"
                    value={draftShapePurpose}
                    disabled={Boolean(selectedShape.locked)}
                    onChange={e => setDraftShapePurpose(e.target.value)}
                    onBlur={commitShapeMeta}
                    onKeyDown={handleShapeMetaKeyDown}
                  />
                </div>
              </div>
              {selectedShape.kind !== 'text' && (
                <div className="form-group" style={{ marginTop: '10px' }}>
                  <label className="label">Optional Label</label>
                  <input
                    type="text"
                    className="input-field"
                    value={draftShapeLabel}
                    disabled={Boolean(selectedShape.locked)}
                    placeholder="e.g. CORE_REGION"
                    onChange={e => setDraftShapeLabel(e.target.value)}
                    onBlur={commitShapeMeta}
                    onKeyDown={handleShapeMetaKeyDown}
                  />
                </div>
              )}
              <div className="form-row" style={{ marginTop: '10px', alignItems: 'center' }}>
                <div className="form-group">
                  <label className="label">Display Color</label>
                  <input
                    type="color"
                    disabled={Boolean(selectedShape.locked)}
                    value={resolveLayerStyle(selectedShape.layer, selectedShape.purpose, selectedShape.color).color}
                    onChange={e => {
                      try {
                        updateShape(selectedShape.id, { color: e.target.value });
                      } catch {
                        // ignore locked
                      }
                    }}
                    style={{ width: '100%', height: '30px', border: 'none', background: 'transparent', cursor: 'pointer' }}
                  />
                </div>
              </div>
            </div>

            {selectedShape.kind === 'text' ? (
              <>
                <div className="prop-section">
                  <h4 className="sub-title">Typography</h4>
                  <div className="form-group" style={{ marginBottom: '10px' }}>
                    <label className="label">Font Size / Height (um)</label>
                    <input
                      type="number"
                      step={gridSize}
                      min={gridSize}
                      className="input-field"
                      value={draftShapeFontSize}
                      disabled={Boolean(selectedShape.locked)}
                      onChange={e => setDraftShapeFontSize(e.target.value)}
                      onBlur={commitTextGeometry}
                      onKeyDown={event => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') {
                          skipNextBlurCommitRef.current = true;
                          setDraftShapeFontSize(formatGridValue(selectedShape.fontSize ?? selectedShape.height, gridSize));
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="label">Font Family</label>
                      <select
                        className="input-field"
                        value={selectedShape.fontFamily ?? 'stick'}
                        disabled={Boolean(selectedShape.locked)}
                        onChange={e => {
                          try {
                            updateShape(selectedShape.id, { fontFamily: e.target.value as LayoutTextFontFamily });
                          } catch {
                            // ignore locked
                          }
                        }}
                      >
                        {LAYOUT_TEXT_FONT_FAMILIES.map(f => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="label">Style</label>
                      <select
                        className="input-field"
                        value={selectedShape.fontStyle ?? 'normal'}
                        disabled={Boolean(selectedShape.locked)}
                        onChange={e => {
                          try {
                            updateShape(selectedShape.id, { fontStyle: e.target.value as LayoutTextFontStyle });
                          } catch {
                            // ignore locked
                          }
                        }}
                      >
                        {LAYOUT_TEXT_FONT_STYLES.map(s => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="prop-section">
                  <h4 className="sub-title">Origin &amp; Orientation (Virtuoso)</h4>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="label">X (um)</label>
                      <input
                        type="number"
                        step={gridSize}
                        className="input-field"
                        value={draftShapeX1}
                        disabled={Boolean(selectedShape.locked)}
                        onChange={e => setDraftShapeX1(e.target.value)}
                        onBlur={commitTextGeometry}
                        onKeyDown={event => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                          if (event.key === 'Escape') {
                            skipNextBlurCommitRef.current = true;
                            setDraftShapeX1(formatGridValue(selectedShape.x, gridSize));
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    </div>
                    <div className="form-group">
                      <label className="label">Y (um)</label>
                      <input
                        type="number"
                        step={gridSize}
                        className="input-field"
                        value={draftShapeY1}
                        disabled={Boolean(selectedShape.locked)}
                        onChange={e => setDraftShapeY1(e.target.value)}
                        onBlur={commitTextGeometry}
                        onKeyDown={event => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                          if (event.key === 'Escape') {
                            skipNextBlurCommitRef.current = true;
                            setDraftShapeY1(formatGridValue(selectedShape.y, gridSize));
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    </div>
                  </div>
                  <div className="form-group transform-orientation">
                    <label className="label">Orientation</label>
                    <select
                      className="input-field"
                      value={selectedShape.orientation ?? 'R0'}
                      disabled={Boolean(selectedShape.locked)}
                      onChange={e => {
                        try {
                          updateShape(selectedShape.id, { orientation: e.target.value as CadenceOrientation });
                        } catch {
                          // ignore locked
                        }
                      }}
                    >
                      {ORIENTATIONS.map(ort => (
                        <option key={ort} value={ort}>{ort}</option>
                      ))}
                    </select>
                    <div className="rotation-actions">
                      <button
                        className="btn"
                        type="button"
                        disabled={Boolean(selectedShape.locked)}
                        onClick={() => updateShape(selectedShape.id, {
                          orientation: rotateOrientationByQuarterTurns(selectedShape.orientation ?? 'R0', -1) as CadenceOrientation,
                        })}
                        title="Rotate 90° clockwise"
                      >
                        <FiRotateCw /> −90°
                      </button>
                      <button
                        className="btn"
                        type="button"
                        disabled={Boolean(selectedShape.locked)}
                        onClick={() => updateShape(selectedShape.id, {
                          orientation: rotateOrientationByQuarterTurns(selectedShape.orientation ?? 'R0', 1) as CadenceOrientation,
                        })}
                        title="Rotate 90° counter-clockwise"
                      >
                        <FiRotateCcw /> +90°
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="prop-section">
                <h4 className="sub-title">bBox Coordinates (um)</h4>
                <div className="prop-row">
                  <span className="prop-label">Size (W × H)</span>
                  <span className="prop-value">
                    {formatGridValue(selectedShape.width, gridSize)} × {formatGridValue(selectedShape.height, gridSize)} µm
                  </span>
                </div>
                <div className="form-row" style={{ marginTop: '8px' }}>
                  <div className="form-group">
                    <label className="label">Left X1</label>
                    <input
                      type="number"
                      step={gridSize}
                      className="input-field"
                      value={draftShapeX1}
                      disabled={Boolean(selectedShape.locked)}
                      onChange={e => setDraftShapeX1(e.target.value)}
                      onBlur={commitShapeBox}
                      onKeyDown={handleShapeBoxKeyDown}
                    />
                  </div>
                  <div className="form-group">
                    <label className="label">Bottom Y1</label>
                    <input
                      type="number"
                      step={gridSize}
                      className="input-field"
                      value={draftShapeY1}
                      disabled={Boolean(selectedShape.locked)}
                      onChange={e => setDraftShapeY1(e.target.value)}
                      onBlur={commitShapeBox}
                      onKeyDown={handleShapeBoxKeyDown}
                    />
                  </div>
                </div>
                <div className="form-row" style={{ marginTop: '10px' }}>
                  <div className="form-group">
                    <label className="label">Right X2</label>
                    <input
                      type="number"
                      step={gridSize}
                      className="input-field"
                      value={draftShapeX2}
                      disabled={Boolean(selectedShape.locked)}
                      onChange={e => setDraftShapeX2(e.target.value)}
                      onBlur={commitShapeBox}
                      onKeyDown={handleShapeBoxKeyDown}
                    />
                  </div>
                  <div className="form-group">
                    <label className="label">Top Y2</label>
                    <input
                      type="number"
                      step={gridSize}
                      className="input-field"
                      value={draftShapeY2}
                      disabled={Boolean(selectedShape.locked)}
                      onChange={e => setDraftShapeY2(e.target.value)}
                      onBlur={commitShapeBox}
                      onKeyDown={handleShapeBoxKeyDown}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="prop-section footer-actions-row">
              <button
                className={`btn lock-toggle-btn${selectedShape.locked ? ' is-locked' : ''}`}
                type="button"
                onClick={() => toggleShapeLock(selectedShape.id)}
                title="Lock or unlock shape (Shift+L)"
              >
                {selectedShape.locked
                  ? <><FiUnlock /> Unlock</>
                  : <><FiLock /> Lock</>}
              </button>
              <button
                className="btn btn-danger"
                type="button"
                disabled={Boolean(selectedShape.locked)}
                onClick={() => {
                  try {
                    deleteShape(selectedShape.id);
                  } catch (error) {
                    notifyError(error, 'Unable to delete shape.');
                  }
                }}
              >
                <FiTrash2 /> Delete
              </button>
            </div>
          </>
        ) : showingPixelArray && pixelArray ? (
          <>
            <div className="panel-header">
              <div className="panel-header__top">
                <h3 className="section-title">Pixel Array</h3>
                {renderPinButton()}
              </div>
              <span className="selection-count selection-count--violet">
                {formatGridValue(pixelArray.width, gridSize)} × {formatGridValue(pixelArray.height, gridSize)} µm
              </span>
            </div>

            <div className="prop-section">
              <h4 className="sub-title">Quick Position</h4>
              <div className="pixel-quick-grid">
                <button
                  className="btn pixel-quick-btn pixel-quick-btn--primary"
                  type="button"
                  onClick={() => centerPixelArray('both')}
                  title="Center Pixel Array in the die (0, 0)"
                >
                  <FiCrosshair /> Center
                </button>
                <button
                  className="btn pixel-quick-btn"
                  type="button"
                  onClick={() => centerPixelArray('x')}
                  title="Center horizontally (CX = 0)"
                >
                  Center X
                </button>
                <button
                  className="btn pixel-quick-btn"
                  type="button"
                  onClick={() => centerPixelArray('y')}
                  title="Center vertically (CY = 0)"
                >
                  Center Y
                </button>
                <button
                  className="btn pixel-quick-btn"
                  type="button"
                  onClick={() => {
                    setAppMode('select');
                    startEdgeAlignment(PIXEL_ARRAY_ALIGNMENT_ID);
                  }}
                  title="Align Pixel Array edges to any IP, boundary, or ruler (A)"
                >
                  <FiAlignCenter /> Align (A)
                </button>
              </div>
            </div>

            <div className="prop-section">
              <h4 className="sub-title">Center &amp; Size (µm)</h4>
              <div className="form-row">
                <div className="form-group">
                  <label className="label">Center X</label>
                  <input
                    type="number"
                    step={gridSize}
                    className="input-field"
                    value={draftArrayCx}
                    onChange={e => setDraftArrayCx(e.target.value)}
                    onBlur={() => commitPixelArrayField('cx')}
                    onKeyDown={handlePixelArrayKeyDown}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Center Y</label>
                  <input
                    type="number"
                    step={gridSize}
                    className="input-field"
                    value={draftArrayCy}
                    onChange={e => setDraftArrayCy(e.target.value)}
                    onBlur={() => commitPixelArrayField('cy')}
                    onKeyDown={handlePixelArrayKeyDown}
                  />
                </div>
              </div>
              <div className="form-row" style={{ marginTop: '8px' }}>
                <div className="form-group">
                  <label className="label">Width</label>
                  <input
                    type="number"
                    min={gridSize}
                    step={gridSize}
                    className="input-field"
                    value={draftArrayW}
                    onChange={e => setDraftArrayW(e.target.value)}
                    onBlur={() => commitPixelArrayField('width')}
                    onKeyDown={handlePixelArrayKeyDown}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Height</label>
                  <input
                    type="number"
                    min={gridSize}
                    step={gridSize}
                    className="input-field"
                    value={draftArrayH}
                    onChange={e => setDraftArrayH(e.target.value)}
                    onBlur={() => commitPixelArrayField('height')}
                    onKeyDown={handlePixelArrayKeyDown}
                  />
                </div>
              </div>
            </div>

            <div className="prop-section">
              <h4 className="sub-title">Die Margins (µm)</h4>
              <div className="form-row">
                <div className="form-group">
                  <label className="label">Left</label>
                  <input
                    type="number"
                    min={0}
                    step={gridSize}
                    className="input-field"
                    value={draftMarginL}
                    onChange={e => setDraftMarginL(e.target.value)}
                    onBlur={() => commitPixelArrayField('marginL')}
                    onKeyDown={handlePixelArrayKeyDown}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Right</label>
                  <input
                    type="number"
                    min={0}
                    step={gridSize}
                    className="input-field"
                    value={draftMarginR}
                    onChange={e => setDraftMarginR(e.target.value)}
                    onBlur={() => commitPixelArrayField('marginR')}
                    onKeyDown={handlePixelArrayKeyDown}
                  />
                </div>
              </div>
              <div className="form-row" style={{ marginTop: '8px' }}>
                <div className="form-group">
                  <label className="label">Bottom</label>
                  <input
                    type="number"
                    min={0}
                    step={gridSize}
                    className="input-field"
                    value={draftMarginB}
                    onChange={e => setDraftMarginB(e.target.value)}
                    onBlur={() => commitPixelArrayField('marginB')}
                    onKeyDown={handlePixelArrayKeyDown}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Top</label>
                  <input
                    type="number"
                    min={0}
                    step={gridSize}
                    className="input-field"
                    value={draftMarginT}
                    onChange={e => setDraftMarginT(e.target.value)}
                    onBlur={() => commitPixelArrayField('marginT')}
                    onKeyDown={handlePixelArrayKeyDown}
                  />
                </div>
              </div>
            </div>

            <div className="prop-section">
              <h4 className="sub-title">Origin (Bottom-Left, µm)</h4>
              <div className="form-row">
                <div className="form-group">
                  <label className="label">X</label>
                  <input
                    type="number"
                    step={gridSize}
                    className="input-field"
                    value={draftArrayX}
                    onChange={e => setDraftArrayX(e.target.value)}
                    onBlur={() => commitPixelArrayField('x')}
                    onKeyDown={handlePixelArrayKeyDown}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Y</label>
                  <input
                    type="number"
                    step={gridSize}
                    className="input-field"
                    value={draftArrayY}
                    onChange={e => setDraftArrayY(e.target.value)}
                    onBlur={() => commitPixelArrayField('y')}
                    onKeyDown={handlePixelArrayKeyDown}
                  />
                </div>
              </div>
              <div className="prop-row" style={{ marginTop: '8px' }}>
                <span className="prop-label">Bounds</span>
                <span className="prop-value prop-value--mono">
                  ({formatGridValue(pixelArray.x, gridSize)}, {formatGridValue(pixelArray.y, gridSize)}) → ({formatGridValue(pixelArray.x + pixelArray.width, gridSize)}, {formatGridValue(pixelArray.y + pixelArray.height, gridSize)})
                </span>
              </div>
              <div className="prop-row">
                <span className="prop-label">Area</span>
                <span className="prop-value">
                  {(pixelArray.width * pixelArray.height).toFixed(2)} µm² ({((pixelArray.width * pixelArray.height) / 1e6).toFixed(3)} mm²)
                </span>
              </div>
            </div>

            <div className="prop-section footer-actions-row">
              <button
                className="btn lock-toggle-btn"
                type="button"
                onClick={() => setPixelArrayVisible(!pixelArray.visible)}
              >
                {pixelArray.visible ? <><FiEyeOff /> Hide</> : <><FiEye /> Show</>}
              </button>
              <button
                className="btn btn-danger"
                type="button"
                onClick={() => {
                  deletePixelArray();
                  pushToast('Pixel array deleted (Ctrl+Z to undo)', 'info');
                }}
              >
                <FiTrash2 /> Delete
              </button>
            </div>
          </>
        ) : !selectedInstance || !masterCell ? (
          <>
            <div className="panel-header">
              <div className="panel-header__top">
                <h3 className="section-title">Properties</h3>
                {renderPinButton()}
              </div>
            </div>
            <div className="empty-state">
              <FiInfo size={24} className="empty-icon" />
              <p>Select an instance, rectangle, text label, or pixel array to inspect its properties.</p>
            </div>
          </>
        ) : (
          <>
            <div className="panel-header">
              <div className="panel-header__top">
                <h3 className="section-title">Properties</h3>
                {renderPinButton()}
              </div>
              {selectedInstanceIds.length > 1 && (
                <span className="selection-count">{selectedInstanceIds.length} blocks selected</span>
              )}
            </div>
            
            <div className="prop-section">
              <div className="form-group" style={{ marginBottom: '10px' }}>
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
                      skipNextBlurCommitRef.current = true;
                      setDraftName(selectedInstance.name);
                      event.currentTarget.blur();
                    }
                  }}
                  aria-label="Instance name"
                />
              </div>
              <div className="prop-row">
                <span className="prop-label">Master Cell</span>
                <span className="prop-value">{masterCell.libName}/{masterCell.cellName}</span>
              </div>
              {(() => {
                const hasSize = masterCell.width > 0 && masterCell.height > 0;
                const b = hasSize
                  ? getPhysicalBounds({
                      ...selectedInstance,
                      width: masterCell.width,
                      height: masterCell.height,
                      originX: masterCell.originX,
                      originY: masterCell.originY,
                    })
                  : null;
                return (
                  <>
                    <div className="prop-row">
                      <span className="prop-label">Size (µm)</span>
                      <span className="prop-value prop-value--mono">
                        {b && isActiveMosaic(selectedInstance.mosaic)
                          ? `${formatGridValue(b.width, gridSize)} × ${formatGridValue(b.height, gridSize)} (${selectedInstance.mosaic.rows}×${selectedInstance.mosaic.cols})`
                          : `${formatGridValue(masterCell.width, gridSize)} × ${formatGridValue(masterCell.height, gridSize)}`}
                      </span>
                    </div>
                    {b && (
                      <div className="prop-row" title="Physical bounding box [Left..Right] × [Bottom..Top]">
                        <span className="prop-label">Bounds</span>
                        <span className="prop-value prop-value--mono">
                          {formatGridValue(b.left, gridSize)}..{formatGridValue(b.right, gridSize)}, {formatGridValue(b.bottom, gridSize)}..{formatGridValue(b.top, gridSize)}
                        </span>
                      </div>
                    )}
                  </>
                );
              })()}
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
                  title={`Descend Edit-in-Place into ${masterCell.libName}/${masterCell.cellName}/layout (X)`}
                >
                  <FiCornerDownRight />
                  <span>
                    Descend (X)
                    {(cellViews[masterCell.id]?.instances.length ?? 0) > 0
                      ? ` · ${cellViews[masterCell.id].instances.length}`
                      : ''}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn new-window-btn"
                  onClick={() => openCellView(masterCell.id)}
                  title={`Open ${masterCell.libName}/${masterCell.cellName}/layout tab`}
                >
                  <FiExternalLink />
                  <span>Open Tab</span>
                </button>
              </div>
            </div>

            <div className="prop-section">
              <h4 className="sub-title">Transform (Virtuoso)</h4>
              {selectedInstance.locked && (
                <div className="locked-banner">
                  Locked — unlock (Shift+L) to move, rotate, align, or delete this block.
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
              {masterCell.kind !== 'pad' && (
                <button
                  type="button"
                  className="btn"
                  style={{ width: '100%', marginTop: '8px', justifyContent: 'center' }}
                  disabled={Boolean(selectedInstance.locked)}
                  onClick={() => {
                    try {
                      updateInstancePosition(selectedInstance.id, 0, 0);
                    } catch (error) {
                      notifyError(error, 'Unable to move this instance to (0, 0).');
                    }
                  }}
                  title="Align instance origin directly to (0, 0)"
                >
                  <FiCrosshair /> Align Origin to (0, 0)
                </button>
              )}
              {selectedBoundaryViolation && (
                <div className="pad-edge-note" role="status">
                  <strong>
                    ⚠ Exceeds {topCellName} boundary ({selectedBoundaryViolation.sides.join(', ')} +{formatGridValue(selectedBoundaryViolation.maxOverflowUm, gridSize)} µm)
                  </strong>
                  <span>
                    Press <strong>X</strong> (Descend Edit) to adjust its internal drawing in place, or reposition this instance.
                  </span>
                </div>
              )}
              {selectedOverlapNames.length > 0 && (
                <div className="overlap-info-note" role="status">
                  <strong>
                    ⓘ Bounding box overlaps {selectedOverlapNames.join(', ')}
                  </strong>
                  <span>
                    Non-fatal notice — normal for pad rings or hierarchical cells (e.g. padring, asp_top) whose bounding box spans other IPs. Not exported to SKILL.
                  </span>
                </div>
              )}
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

            {(activeCellId !== null || masterCell.kind !== 'pad') && (
              <div className="prop-section">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <h4 className="sub-title" style={{ marginBottom: 0 }}>Mosaic Array (Virtuoso)</h4>
                  {isActiveMosaic(selectedInstance.mosaic) && (
                    <span className="selection-count">
                      {selectedInstance.mosaic.rows}×{selectedInstance.mosaic.cols}
                    </span>
                  )}
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="label">Rows</label>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      step={1}
                      className="input-field"
                      value={draftMosaicRows}
                      disabled={Boolean(selectedInstance.locked)}
                      onChange={e => setDraftMosaicRows(e.target.value)}
                      onBlur={commitMosaic}
                      onKeyDown={handleMosaicKeyDown}
                    />
                  </div>
                  <div className="form-group">
                    <label className="label">Columns</label>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      step={1}
                      className="input-field"
                      value={draftMosaicCols}
                      disabled={Boolean(selectedInstance.locked)}
                      onChange={e => setDraftMosaicCols(e.target.value)}
                      onBlur={commitMosaic}
                      onKeyDown={handleMosaicKeyDown}
                    />
                  </div>
                </div>
                <div className="form-row" style={{ marginTop: '10px' }}>
                  <div className="form-group">
                    <label className="label">Col Pitch ΔX (um)</label>
                    <input
                      type="number"
                      step={gridSize}
                      className="input-field"
                      value={draftMosaicColPitch}
                      disabled={Boolean(selectedInstance.locked)}
                      onChange={e => setDraftMosaicColPitch(e.target.value)}
                      onBlur={commitMosaic}
                      onKeyDown={handleMosaicKeyDown}
                    />
                  </div>
                  <div className="form-group">
                    <label className="label">Row Pitch ΔY (um)</label>
                    <input
                      type="number"
                      step={gridSize}
                      className="input-field"
                      value={draftMosaicRowPitch}
                      disabled={Boolean(selectedInstance.locked)}
                      onChange={e => setDraftMosaicRowPitch(e.target.value)}
                      onBlur={commitMosaic}
                      onKeyDown={handleMosaicKeyDown}
                    />
                  </div>
                </div>
                {isActiveMosaic(selectedInstance.mosaic) && (
                  <div className="rotation-actions" style={{ marginTop: '10px' }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={Boolean(selectedInstance.locked || selectedInstance.mosaic.rows * selectedInstance.mosaic.cols > 500)}
                      onClick={() => {
                        try {
                          flattenMosaicInstance(selectedInstance.id);
                        } catch (error) {
                          notifyError(error, 'Unable to flatten mosaic.');
                        }
                      }}
                      title={
                        selectedInstance.mosaic.rows * selectedInstance.mosaic.cols > 500
                          ? 'Flatten supports up to 500 instances'
                          : 'Explode mosaic into individual editable instances'
                      }
                    >
                      <FiGrid /> Flatten ({selectedInstance.mosaic.rows * selectedInstance.mosaic.cols})
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={Boolean(selectedInstance.locked)}
                      onClick={() => {
                        try {
                          updateInstanceMosaic(selectedInstance.id, null);
                        } catch (error) {
                          notifyError(error, 'Unable to reset mosaic.');
                        }
                      }}
                      title="Reset back to a single 1×1 instance"
                    >
                      Reset 1×1
                    </button>
                  </div>
                )}
              </div>
            )}

            {(() => {
              const targetIds = selectedInstanceIds.length > 0 ? selectedInstanceIds : [selectedInstance.id];
              const targetSet = new Set(targetIds);
              const targetInstances = instances.filter(inst => targetSet.has(inst.id));
              const unlockedCount = targetInstances.filter(inst => !inst.locked).length;
              const willLock = unlockedCount > 0;
              return (
                <div className="prop-section footer-actions-row">
                  <button
                    className={`btn lock-toggle-btn${!willLock ? ' is-locked' : ''}`}
                    type="button"
                    onClick={() => toggleInstanceLock(targetIds)}
                    title="Lock or unlock selection (Shift+L)"
                  >
                    {willLock
                      ? <><FiLock /> Lock{targetIds.length > 1 ? ` (${unlockedCount})` : ''}</>
                      : <><FiUnlock /> Unlock{targetIds.length > 1 ? ` (${targetIds.length})` : ''}</>}
                  </button>
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={unlockedCount === 0}
                    onClick={deleteSelectedInstances}
                    title={unlockedCount === 0 ? 'Unlock before deleting' : 'Delete unlocked selected instance(s) (Del)'}
                  >
                    <FiTrash2 /> Delete{targetIds.length > 1 ? ` (${unlockedCount})` : ''}
                  </button>
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
};
