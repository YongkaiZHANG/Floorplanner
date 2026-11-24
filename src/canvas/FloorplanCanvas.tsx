import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Stage, Layer, Rect, Text, Group, Line, Circle } from 'react-konva';
import { useStore, clampInstancePosition, computePadGroupPositions, findOverlappingInstance, getTransformProps, isCellEmpty, PIXEL_ARRAY_ALIGNMENT_ID, rotateOrientationByQuarterTurns, snapPadToAutoOrientedEdge, snapPadToNearestEdge } from '../store/useStore';
import type { Instance } from '../store/useStore';
import { getAlignmentEdgeAxis, getPhysicalBounds } from '../utils/alignment';
import type { AlignmentEdge } from '../utils/alignment';
import { collapseCollinearPadCandidates, labelRectsOverlap } from '../utils/autoDim';
import type { ScreenLabelRect } from '../utils/autoDim';
import { SCALE_FACTOR } from '../utils/canvasConstants';
import { computeDisplayGridStep, resolveActiveSnapStep, resolveCanvasCursor, snapPointToGrid } from '../utils/canvasCursor';
import { findOverlapViolations } from '../utils/floorplanMetrics';
import { formatGridValue, snapToGrid } from '../utils/grid';
import {
  applyCadenceOrientationVector,
  applyCadenceTransformPoint,
  computeActiveToBaseTransform,
  invertCadenceTransform,
} from '../utils/hierarchy';
import { normalizeRectFromPoints, resolveLayerStyle, VIRTUOSO_LAYER_PRESETS } from '../utils/layoutLayers';
import type { LayoutShape } from '../utils/layoutLayers';
import { getIpPixelArrayEdgeMeasurements } from '../utils/pixelArrayDimensions';
import { resolveOrthogonalRulerEnd } from '../utils/ruler';
import type { SnapEdgeAxis } from '../utils/ruler';
import {
  computeStretchedShapes,
  countPartialSelectedEdges,
  countPartialSelectedShapes,
  hasPartialSelection,
  hitTestShapeEdgeOrCorner,
  mergePartialSelections,
  selectShapeEdgesInBox,
} from '../utils/shapeStretch';
import type { PartialShapeSelection, RectEdge, StretchHitResult } from '../utils/shapeStretch';
import { panViewportByArrow } from '../utils/viewport';
import type { ArrowPanKey } from '../utils/viewport';
import Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { FiArrowUp, FiCrosshair, FiEye, FiEyeOff, FiGrid, FiMaximize2, FiMinus, FiPlus, FiX } from 'react-icons/fi';
import './FloorplanCanvas.css';

const ZOOM_SPEED = 1.1;
const MIN_STAGE_SCALE = 1e-5;
const MAX_STAGE_SCALE = 50;
const MARQUEE_DRAG_THRESHOLD_PX = 3;
const CANVAS_FONT_SANS = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif";
const CANVAS_FONT_MONO = "ui-monospace, 'SF Mono', 'Cascadia Code', Consolas, monospace";

export const FloorplanCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  
  // Konva cannot draw a zero-sized backing canvas during the first layout pass.
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 }); 
  const [stageScale, setStageScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);

  // Measure Mode State
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measureStart, setMeasureStart] = useState<{ x: number; y: number; snapEdgeAxis?: SnapEdgeAxis } | null>(null);
  const [currentRuler, setCurrentRuler] = useState<{ startX: number; startY: number; endX: number; endY: number; referenceX?: number; referenceY?: number } | null>(null);
  const [hoveredRulerId, setHoveredRulerId] = useState<string | null>(null);
  const [hoveredAutoDimKey, setHoveredAutoDimKey] = useState<string | null>(null);
  const [hoveredAlignEdge, setHoveredAlignEdge] = useState<string | null>(null);
  const [snapIndicator, setSnapIndicator] = useState<{ x: number; y: number } | null>(null);

  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const selectionBoxRef = useRef<typeof selectionBox>(null);
  const marqueeDraggedRef = useRef(false);
  const ignoreBackgroundClickUntilRef = useRef(0);
  const [rectDraft, setRectDraft] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const rectDraftRef = useRef<typeof rectDraft>(null);
  const rectDraggingRef = useRef(false);
  const [shapeResizePreview, setShapeResizePreview] = useState<{ id: string; x: number; y: number; width: number; height: number } | null>(null);
  const [partialSelection, setPartialSelection] = useState<PartialShapeSelection>({});
  const partialSelectionRef = useRef<PartialShapeSelection>({});
  const [hoveredStretchHit, setHoveredStretchHit] = useState<StretchHitResult | null>(null);
  const [stretchSession, setStretchSession] = useState<{
    anchorX: number;
    anchorY: number;
    currentX: number;
    currentY: number;
    selection: PartialShapeSelection;
  } | null>(null);
  const stretchSessionRef = useRef<typeof stretchSession>(null);
  const stretchDraggingRef = useRef(false);
  const [partialMarquee, setPartialMarquee] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const partialMarqueeRef = useRef<typeof partialMarquee>(null);
  const partialMarqueeDraggedRef = useRef(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number; stageX: number; stageY: number } | null>(null);
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [multiDragDelta, setMultiDragDelta] = useState<{ anchorId: string; dx: number; dy: number } | null>(null);
  const multiDragBoundsRef = useRef<{
    anchorId: string;
    startX: number;
    startY: number;
    minDx: number;
    maxDx: number;
    minDy: number;
    maxDy: number;
  } | null>(null);

  const { 

    appMode,
    setAppMode,
    topWidth,
    topHeight,
    topCellName,
    padInset,
    masterCells, 
    instances,
    shapes,
    activeCoordinateMode,
    cellViews,
    activeCellId,
    rootView,
    descendStack,
    showEditInPlaceContext,
    toggleEditInPlaceContext,
    partialSelectMode,
    windowLayoutMode,
    openViewIds,
    descendIntoInstance,
    ascendToParent,
    rulers,
    gridSize, 
    updateInstancePosition,
    moveInstancesByDelta,
    selectedInstanceId,
    selectedInstanceIds,
    setSelectedInstance,
    selectedShapeId,
    setSelectedShape,
    activeDrawLayer,
    activeDrawPurpose,
    activeDrawLabel,
    activeDrawColor,
    setActiveDrawLpp,
    setActiveDrawLabel,
    addShape,
    updateShape,
    batchUpdateShapes,
    addRuler,
    deleteRuler,
    clearRulers,
    placementMasterId,
    placementOrientation,
    pendingInstanceArray,
    setPlacementOrientation,
    placeInstance,
    placeInstanceMosaic,
    pendingManualPadGroup,
    placeManualPadGroup,
    setRightSidebarPinned,
    orthogonalRuler,
    showAutoDim,
    showOverlapDrc,
    showGrid,
    toggleGrid,
    snapToVisibleGrid,
    toggleSnapToVisibleGrid,
    edgeAlignmentSession,
    setEdgeAlignmentEdge,
    completeEdgeAlignment,
    completeEdgeAlignmentToBoundary,
    completeEdgeAlignmentToRuler,
    pixelArray,
    pendingPixelArraySize,
    placePixelArray,
    updatePixelArrayPosition,
    pixelArraySelected,
    setPixelArraySelected,
  } = useStore();

  const activeMasterCell = activeCellId ? masterCells[activeCellId] ?? null : null;
  const isSubCellCanvas = activeCellId !== null;
  const isEditInPlace = isSubCellCanvas && descendStack.length > 0;
  const eipBaseCellId = isEditInPlace ? descendStack[0].parentCellId : activeCellId;
  const baseIsRoot = eipBaseCellId === null;
  const baseMasterCell = eipBaseCellId ? masterCells[eipBaseCellId] ?? null : null;
  const baseWidth = baseIsRoot
    ? (isEditInPlace ? (rootView?.topWidth ?? topWidth) : topWidth)
    : (baseMasterCell?.width ?? topWidth);
  const baseHeight = baseIsRoot
    ? (isEditInPlace ? (rootView?.topHeight ?? topHeight) : topHeight)
    : (baseMasterCell?.height ?? topHeight);
  const baseCellName = baseIsRoot
    ? (isEditInPlace ? (rootView?.topCellName ?? topCellName) : topCellName)
    : (baseMasterCell?.cellName ?? topCellName);
  const basePadInset = baseIsRoot
    ? (isEditInPlace ? (rootView?.padInset ?? 0) : padInset)
    : (isEditInPlace ? (cellViews[eipBaseCellId ?? '']?.padInset ?? 0) : padInset);
  const isOriginSubCell = isSubCellCanvas && activeCoordinateMode !== 'centered';
  const activeBoundaryBox = useMemo(() => {
    if (isOriginSubCell && activeMasterCell) {
      const ox = activeMasterCell.originX ?? 0;
      const oy = activeMasterCell.originY ?? 0;
      return { minX: ox, minY: oy, maxX: ox + topWidth, maxY: oy + topHeight };
    }
    return { minX: -topWidth / 2, minY: -topHeight / 2, maxX: topWidth / 2, maxY: topHeight / 2 };
  }, [isOriginSubCell, activeMasterCell, topWidth, topHeight]);

  const baseBoundaryBox = useMemo(() => {
    if (baseIsRoot) {
      return { minX: -baseWidth / 2, minY: -baseHeight / 2, maxX: baseWidth / 2, maxY: baseHeight / 2 };
    }
    if (baseMasterCell) {
      const baseView = eipBaseCellId ? cellViews[eipBaseCellId] : undefined;
      const baseCentered = baseView?.coordinateMode === 'centered'
        || (baseView?.coordinateMode === undefined && (baseView?.shapes?.length ?? 0) === 0 && (baseView?.instances?.length ?? 0) > 0);
      if (!baseCentered) {
        const ox = baseMasterCell.originX ?? 0;
        const oy = baseMasterCell.originY ?? 0;
        return { minX: ox, minY: oy, maxX: ox + baseWidth, maxY: oy + baseHeight };
      }
    }
    return { minX: -baseWidth / 2, minY: -baseHeight / 2, maxX: baseWidth / 2, maxY: baseHeight / 2 };
  }, [baseIsRoot, baseWidth, baseHeight, baseMasterCell, eipBaseCellId, cellViews]);

  const liveEipChain = useMemo(() => (
    descendStack.map(step => {
      const liveParent = step.parentCellId ? masterCells[step.parentCellId] : null;
      return {
        ...step,
        parentWidth: liveParent?.width ?? (step.parentCellId === null ? (rootView?.topWidth ?? step.parentWidth) : step.parentWidth),
        parentHeight: liveParent?.height ?? (step.parentCellId === null ? (rootView?.topHeight ?? step.parentHeight) : step.parentHeight),
      };
    })
  ), [descendStack, masterCells, rootView]);

  const eipForwardTransform = useMemo(() => (
    isEditInPlace
      ? computeActiveToBaseTransform(liveEipChain, activeCoordinateMode, topWidth, topHeight)
      : { x: 0, y: 0, orientation: 'R0' as const }
  ), [isEditInPlace, liveEipChain, activeCoordinateMode, topWidth, topHeight]);

  const eipInverseTransform = useMemo(() => (
    isEditInPlace
      ? invertCadenceTransform(eipForwardTransform)
      : { x: 0, y: 0, orientation: 'R0' as const }
  ), [isEditInPlace, eipForwardTransform]);

  const eipForwardProps = useMemo(
    () => getTransformProps(eipForwardTransform.orientation),
    [eipForwardTransform.orientation],
  );

  const eipInverseTransformRef = useRef(eipInverseTransform);
  useEffect(() => {
    eipInverseTransformRef.current = eipInverseTransform;
  }, [eipInverseTransform]);

  const baseToEditPoint = useCallback((bx: number, by: number) => (
    isEditInPlace ? applyCadenceTransformPoint(eipInverseTransform, bx, by) : { x: bx, y: by }
  ), [isEditInPlace, eipInverseTransform]);

  const editToBasePoint = useCallback((ex: number, ey: number) => (
    isEditInPlace ? applyCadenceTransformPoint(eipForwardTransform, ex, ey) : { x: ex, y: ey }
  ), [isEditInPlace, eipForwardTransform]);

  const isSubCellEmpty = isSubCellCanvas && shapes.length === 0 && instances.length === 0 && !pixelArray;
  const isTrulyEmptyBaseView = !baseIsRoot && (
    isEditInPlace
      ? isCellEmpty({ width: baseWidth, height: baseHeight })
      : (isSubCellEmpty && isCellEmpty({ width: topWidth, height: topHeight }))
  );
  const gridExtentUm = useMemo(() => {
    if (baseIsRoot) {
      return { minX: -baseWidth / 2, maxX: baseWidth / 2, minY: -baseHeight / 2, maxY: baseHeight / 2 };
    }
    if (isTrulyEmptyBaseView || baseWidth <= 0 || baseHeight <= 0) {
      const halfSpan = Math.max(gridSize * 200, 200);
      return { minX: -halfSpan, maxX: halfSpan, minY: -halfSpan * 0.75, maxY: halfSpan * 0.75 };
    }
    return {
      minX: Math.min(baseBoundaryBox.minX, 0),
      maxX: Math.max(baseBoundaryBox.maxX, 0),
      minY: Math.min(baseBoundaryBox.minY, 0),
      maxY: Math.max(baseBoundaryBox.maxY, 0),
    };
  }, [baseIsRoot, isTrulyEmptyBaseView, baseWidth, baseHeight, baseBoundaryBox, gridSize]);

  const displayGrid = useMemo(
    () => {
      const spanX = !baseIsRoot && stageScale > 0 && dimensions.width > 1
        ? dimensions.width / (stageScale * SCALE_FACTOR)
        : Math.max(1, gridExtentUm.maxX - gridExtentUm.minX);
      const spanY = !baseIsRoot && stageScale > 0 && dimensions.height > 1
        ? dimensions.height / (stageScale * SCALE_FACTOR)
        : Math.max(1, gridExtentUm.maxY - gridExtentUm.minY);
      return computeDisplayGridStep(gridSize, stageScale, SCALE_FACTOR, Math.max(1, spanX), Math.max(1, spanY));
    },
    [gridSize, stageScale, gridExtentUm, baseIsRoot, dimensions.width, dimensions.height],
  );
  const activeSnapStep = resolveActiveSnapStep(gridSize, displayGrid.minorStep, snapToVisibleGrid);
  const activeSnapStepRef = useRef(activeSnapStep);
  useEffect(() => {
    activeSnapStepRef.current = activeSnapStep;
  }, [activeSnapStep]);

  const updatePartialSelection = useCallback((next: PartialShapeSelection) => {
    partialSelectionRef.current = next;
    setPartialSelection(next);
  }, []);

  useEffect(() => {
    if (appMode !== 'rect') {
      rectDraftRef.current = null;
      rectDraggingRef.current = false;
      setRectDraft(null);
    }
    if (appMode !== 'stretch') {
      stretchSessionRef.current = null;
      stretchDraggingRef.current = false;
      setStretchSession(null);
    }
    if (appMode !== 'stretch' && !partialSelectMode) {
      setHoveredStretchHit(null);
    }
  }, [appMode, activeCellId, partialSelectMode]);

  useEffect(() => {
    // Clear partial selection & stretch gestures when switching cellviews
    partialSelectionRef.current = {};
    setPartialSelection({});
    stretchSessionRef.current = null;
    stretchDraggingRef.current = false;
    setStretchSession(null);
    partialMarqueeRef.current = null;
    partialMarqueeDraggedRef.current = false;
    setPartialMarquee(null);
    setHoveredStretchHit(null);
  }, [activeCellId]);

  useEffect(() => {
    // Prune partial selection entries for deleted or locked shapes
    const current = partialSelectionRef.current;
    const keys = Object.keys(current);
    if (keys.length === 0) return;
    const validIds = new Set(shapes.filter(s => !s.locked).map(s => s.id));
    if (keys.every(id => validIds.has(id))) return;
    const pruned: PartialShapeSelection = {};
    for (const id of keys) {
      if (validIds.has(id) && current[id].length > 0) pruned[id] = current[id];
    }
    updatePartialSelection(pruned);
  }, [shapes, updatePartialSelection]);

  const snappedMousePos = useMemo(() => {
    if (!mousePos) return null;
    if (appMode === 'measure' && snapIndicator) return mousePos;
    return snapPointToGrid(mousePos.x, mousePos.y, activeSnapStep);
  }, [mousePos, appMode, snapIndicator, activeSnapStep]);

  const clampWithSnapStep = (x: number, y: number, orientation: string, width: number, height: number, originX = 0, originY = 0) => {
    if (isSubCellCanvas) {
      return snapPointToGrid(x, y, activeSnapStep);
    }
    try {
      return clampInstancePosition(x, y, orientation, width, height, topWidth, topHeight, activeSnapStep, originX, originY);
    } catch {
      return clampInstancePosition(x, y, orientation, width, height, topWidth, topHeight, gridSize, originX, originY);
    }
  };

  const fitView = useCallback(() => {
    if (containerRef.current) {
      const { offsetHeight, offsetWidth } = containerRef.current;
      let minX = baseBoundaryBox.minX;
      let maxX = baseBoundaryBox.maxX;
      let minY = baseBoundaryBox.minY;
      let maxY = baseBoundaryBox.maxY;

      if (!baseIsRoot) {
        if (isTrulyEmptyBaseView || baseWidth <= 0 || baseHeight <= 0) {
          const halfW = Math.max(gridSize * 200, 200);
          const halfH = Math.max(gridSize * 150, 150);
          minX = -halfW;
          maxX = halfW;
          minY = -halfH;
          maxY = halfH;
        } else {
          minX = Math.min(minX, 0);
          maxX = Math.max(maxX, 0);
          minY = Math.min(minY, 0);
          maxY = Math.max(maxY, 0);
        }
      }

      const spanW = Math.max(gridSize * 10, maxX - minX) * SCALE_FACTOR;
      const spanH = Math.max(gridSize * 10, maxY - minY) * SCALE_FACTOR;
      const centerX = ((minX + maxX) / 2) * SCALE_FACTOR;
      const centerY = ((minY + maxY) / 2) * SCALE_FACTOR;
      
      const padding = 72;
      const availableWidth = Math.max(1, offsetWidth - padding * 2);
      const availableHeight = Math.max(1, offsetHeight - padding * 2);
      const scaleX = availableWidth / spanW;
      const scaleY = availableHeight / spanH;
      const initialScale = Math.max(MIN_STAGE_SCALE, Math.min(scaleX, scaleY, 1.5));
      
      setFitScale(initialScale);
      setStageScale(initialScale);
      setStagePos({ 
        x: offsetWidth / 2 - centerX * initialScale, 
        y: offsetHeight / 2 + centerY * initialScale, 
      }); 
    }
  }, [baseBoundaryBox, baseIsRoot, isTrulyEmptyBaseView, baseWidth, baseHeight, gridSize]);

  const fitViewRef = useRef(fitView);
  useEffect(() => {
    fitViewRef.current = fitView;
  }, [fitView]);

  // Camera stays locked when entering or leaving Edit-in-Place (X / Return) inside the same base view!
  const cameraViewKey = eipBaseCellId ?? '__root__';
  const rootDimensionsKey = baseIsRoot ? `${baseWidth}x${baseHeight}` : 'subcell';
  useEffect(() => {
    const timer = window.setTimeout(() => {
      fitViewRef.current();
    }, 20);
    return () => window.clearTimeout(timer);
  }, [cameraViewKey, windowLayoutMode, openViewIds.length, rootDimensionsKey]);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: Math.max(1, containerRef.current.offsetWidth),
          height: Math.max(1, containerRef.current.offsetHeight),
        });
      }
    };
    const timer = window.setTimeout(updateSize, 50);
    window.addEventListener('resize', updateSize);
    const observer = typeof ResizeObserver !== 'undefined' && containerRef.current
      ? new ResizeObserver(updateSize)
      : null;
    if (observer && containerRef.current) observer.observe(containerRef.current);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', updateSize);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement || (e.target instanceof HTMLElement && e.target.isContentEditable)) {
        return;
      }
      
      const key = e.key.toLowerCase();
      
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpaceDown(true);
        return;
      }

      const state = useStore.getState();

      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        e.preventDefault();
        if (e.altKey && (hasPartialSelection(partialSelectionRef.current) || state.selectedInstanceIds.length > 0 || state.selectedShapeId)) {
          const dxScreen = key === 'arrowright' ? 1 : key === 'arrowleft' ? -1 : 0;
          const dyScreen = key === 'arrowup' ? 1 : key === 'arrowdown' ? -1 : 0;
          const multiplier = e.shiftKey ? 10 : 1;
          const step = activeSnapStepRef.current;
          const rawDx = dxScreen * multiplier * step;
          const rawDy = dyScreen * multiplier * step;
          const delta = state.descendStack.length > 0
            ? applyCadenceOrientationVector(eipInverseTransformRef.current.orientation, rawDx, rawDy)
            : { dx: rawDx, dy: rawDy };
          if (hasPartialSelection(partialSelectionRef.current)) {
            const updates = computeStretchedShapes(
              state.shapes,
              partialSelectionRef.current,
              delta.dx,
              delta.dy,
              step,
              state.gridSize,
            );
            state.batchUpdateShapes(updates);
          } else if (state.selectedShapeId) {
            state.nudgeSelectedShape(delta.dx, delta.dy);
          } else {
            state.nudgeSelection(delta.dx, delta.dy);
          }
          return;
        }
        const panDistance = e.shiftKey ? 160 : 48;
        setStagePos(position => panViewportByArrow(position, key as ArrowPanKey, panDistance));
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (key === 'c') {
          e.preventDefault();
          state.copySelection();
          return;
        }
        if (key === 'v') {
          e.preventDefault();
          state.pasteClipboard();
          return;
        }
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) state.redo();
          else state.undo();
          return;
        }
        if (key === 'y') {
          e.preventDefault();
          state.redo();
          return;
        }
        if (key === 'a') {
          e.preventDefault();
          state.selectAllInstances();
          return;
        }
        if (key === 'b' && state.activeCellId) {
          e.preventDefault();
          state.ascendToParent();
          return;
        }
      }
      
      switch (key) {
        case 'e':
        case 'x':
          e.preventDefault();
          if (state.selectedInstanceId) {
            state.descendIntoInstance(state.selectedInstanceId);
          }
          break;
        case 'b':
          if (e.shiftKey && state.activeCellId) {
            e.preventDefault();
            state.ascendToParent();
          }
          break;
        case 'f':
          e.preventDefault();
          fitView();
          break;
        case 'n':
          e.preventDefault();
          state.setShowCreateModal(true);
          break;
        case 'i':
          e.preventDefault();
          if (Object.keys(state.masterCells).length > 0) {
            state.setShowInstantiateModal(true);
          } else {
            state.setShowCreateModal(true);
          }
          break;
        case 'c':
          e.preventDefault();
          if (state.selectedInstanceId) {
            const inst = state.instances.find(i => i.id === state.selectedInstanceId);
            if (inst) {
              state.setPlacement(inst.cellId, inst.orientation);
            }
          }
          break;
        case 'q':
          e.preventDefault();
          if (state.selectedInstanceId || state.selectedShapeId || state.pixelArraySelected) {
            state.setRightSidebarPinned(!state.rightSidebarPinned);
          }
          break;
        case 'k':
          e.preventDefault();
          if (e.shiftKey) {
            clearRulers();
          } else {
            setAppMode('measure');
          }
          break;
        case 'm':
          e.preventDefault();
          setAppMode('select');
          break;
        case 's':
          if (!e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            setAppMode('stretch');
          }
          break;
        case 'f4':
          e.preventDefault();
          state.togglePartialSelectMode();
          break;
        case 'd':
          e.preventDefault();
          setAppMode('rect');
          break;
        case 'backspace':
        case 'delete':
          if (state.selectedShapeId) {
            try {
              state.deleteShape(state.selectedShapeId);
            } catch (error) {
              alert(error instanceof Error ? error.message : 'Unable to delete the selected shape.');
            }
          } else if (state.selectedInstanceIds.length > 0) {
            state.deleteSelectedInstances();
          }
          break;
        case 'u':
          e.preventDefault();
          state.undo();
          break;
        case 'o':
          e.preventDefault();
          state.toggleOrthogonalRuler();
          break;
        case 'g':
          e.preventDefault();
          if (e.shiftKey) {
            state.toggleSnapToVisibleGrid();
          } else {
            state.toggleGrid();
          }
          break;
        case 'l':
          e.preventDefault();
          if (state.selectedShapeId) {
            state.toggleShapeLock(state.selectedShapeId);
          } else if (state.selectedInstanceIds.length > 0) {
            state.toggleInstanceLock(state.selectedInstanceIds);
          }
          break;
        case 'r':
          e.preventDefault();
          if (state.appMode === 'place' && state.placementMasterId) {
            state.setPlacementOrientation(
              rotateOrientationByQuarterTurns(state.placementOrientation, e.shiftKey ? -1 : 1),
            );
            break;
          }
          if (state.selectedInstanceId) {
            const instance = state.instances.find(item => item.id === state.selectedInstanceId);
            if (instance) {
              try {
                state.updateInstanceOrientation(
                  instance.id,
                  rotateOrientationByQuarterTurns(instance.orientation, e.shiftKey ? -1 : 1),
                );
              } catch (error) {
                alert(error instanceof Error ? error.message : 'Unable to rotate the selected block.');
              }
            }
          } else {
            // Cadence Virtuoso bindkey: R creates a rectangle when no instance is selected
            setAppMode('rect');
          }
          break;
        case 'a':
          e.preventDefault();
          if (state.pixelArraySelected) state.startEdgeAlignment(PIXEL_ARRAY_ALIGNMENT_ID);
          else if (state.selectedInstanceId) state.startEdgeAlignment(state.selectedInstanceId);
          break;
        case 'escape':
          if (stretchSessionRef.current) {
            stretchSessionRef.current = null;
            stretchDraggingRef.current = false;
            setStretchSession(null);
          } else if (partialMarqueeRef.current) {
            partialMarqueeRef.current = null;
            partialMarqueeDraggedRef.current = false;
            setPartialMarquee(null);
          } else if (hasPartialSelection(partialSelectionRef.current)) {
            updatePartialSelection({});
          } else if (state.appMode === 'stretch') {
            setAppMode('select');
          } else if (state.edgeAlignmentSession) {
            state.cancelEdgeAlignment();
          } else if (state.appMode === 'rect') {
            if (rectDraftRef.current) {
              rectDraftRef.current = null;
              rectDraggingRef.current = false;
              setRectDraft(null);
            } else {
              setAppMode('select');
            }
          } else if (state.appMode === 'place') {
            state.setPlacement(null);
          } else if (state.appMode === 'pixel-array') {
            state.setAppMode('select');
          } else if (state.appMode === 'measure') {
            setAppMode('select');
            setIsMeasuring(false);
            setMeasureStart(null);
            setCurrentRuler(null);
            setSnapIndicator(null);
          } else if (state.selectedShapeId) {
            state.setSelectedShape(null);
          } else if (state.selectedInstanceId || state.selectedInstanceIds.length > 0) {
            setSelectedInstance(null);
          } else if (state.pixelArraySelected) {
            state.setPixelArraySelected(false);
          }
          break;
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpaceDown(false);
      }
    };

    const handleWindowBlur = () => {
      setIsSpaceDown(false);
      if (stretchDraggingRef.current) {
        stretchDraggingRef.current = false;
        stretchSessionRef.current = null;
        setStretchSession(null);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [clearRulers, fitView, setAppMode, setSelectedInstance, updatePartialSelection]);

  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    if (!stageRef.current) return;

    const stage = stageRef.current;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / -oldScale, 
    };

    const rawScale = e.evt.deltaY < 0 ? oldScale * ZOOM_SPEED : oldScale / ZOOM_SPEED;
    const newScale = Math.max(MIN_STAGE_SCALE, Math.min(MAX_STAGE_SCALE, rawScale));
    setStageScale(newScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * -newScale,
    });
  };

  const zoomAroundCenter = (factor: number) => {
    const cx = dimensions.width / 2;
    const cy = dimensions.height / 2;
    const oldScale = stageScale;
    const newScale = Math.max(MIN_STAGE_SCALE, Math.min(MAX_STAGE_SCALE, oldScale * factor));
    const centerWorldX = (cx - stagePos.x) / oldScale;
    const centerWorldY = (cy - stagePos.y) / -oldScale;
    setStageScale(newScale);
    setStagePos({
      x: cx - centerWorldX * newScale,
      y: cy - centerWorldY * -newScale,
    });
  };



  const getClosestPointOnSegment = (p: {x: number, y: number}, a: {x: number, y: number}, b: {x: number, y: number}) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx*dx + dy*dy;
    if (l2 === 0) return { x: a.x, y: a.y, dist: Math.hypot(p.x - a.x, p.y - a.y) };
    
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    return { x: cx, y: cy, dist: Math.hypot(p.x - cx, p.y - cy) };
  };

  const getInstanceCorners = (inst: Instance) => {
    const master = masterCells[inst.cellId];
    if (!master) return null;
    const bounds = getPhysicalBounds({
      ...inst,
      width: master.width,
      height: master.height,
      originX: master.originX,
      originY: master.originY,
    });
    return [
      { x: bounds.left, y: bounds.bottom },
      { x: bounds.right, y: bounds.bottom },
      { x: bounds.right, y: bounds.top },
      { x: bounds.left, y: bounds.top },
    ];
  };

  const getSnappedWorldPos = (pointer: { x: number, y: number }, applyObjectSnapping: boolean = false) => {
    const worldX = (pointer.x - stagePos.x) / stageScale;
    const worldY = (pointer.y - stagePos.y) / -stageScale; 
    let umX = worldX / SCALE_FACTOR;
    let umY = worldY / SCALE_FACTOR;

    if (applyObjectSnapping) {
      let bestSnap: { x: number, y: number, dist: number, snapEdgeAxis: SnapEdgeAxis } | null = null;
      const snapRadiusUm = 15 / (SCALE_FACTOR * stageScale); // 15 screen pixels radius
      
      const segments: {a: {x:number, y:number}, b: {x:number, y:number}, axis: SnapEdgeAxis}[] = [];
      
      // base cell boundary
      const topAsicCorners = [
        { x: baseBoundaryBox.minX, y: baseBoundaryBox.minY },
        { x: baseBoundaryBox.maxX, y: baseBoundaryBox.minY },
        { x: baseBoundaryBox.maxX, y: baseBoundaryBox.maxY },
        { x: baseBoundaryBox.minX, y: baseBoundaryBox.maxY },
      ];
      for (let i=0; i<4; i++) {
        const a = topAsicCorners[i];
        const b = topAsicCorners[(i+1)%4];
        segments.push({ a, b, axis: Math.abs(a.x - b.x) <= 1e-9 ? 'vertical' : 'horizontal' });
      }

      // drawn shapes (for snapping rulers cleanly onto shape edges too)
      for (const shape of shapes) {
        const shapeCorners = [
          editToBasePoint(shape.x, shape.y),
          editToBasePoint(shape.x + shape.width, shape.y),
          editToBasePoint(shape.x + shape.width, shape.y + shape.height),
          editToBasePoint(shape.x, shape.y + shape.height),
        ];
        for (let i = 0; i < 4; i++) {
          const a = shapeCorners[i];
          const b = shapeCorners[(i + 1) % 4];
          segments.push({ a, b, axis: Math.abs(a.x - b.x) <= 1e-9 ? 'vertical' : 'horizontal' });
        }
      }

      // visible pixel array boundary
      if (pixelArray?.visible) {
        const arrayCorners = [
          editToBasePoint(pixelArray.x, pixelArray.y),
          editToBasePoint(pixelArray.x + pixelArray.width, pixelArray.y),
          editToBasePoint(pixelArray.x + pixelArray.width, pixelArray.y + pixelArray.height),
          editToBasePoint(pixelArray.x, pixelArray.y + pixelArray.height),
        ];
        for (let i = 0; i < 4; i++) {
          const a = arrayCorners[i];
          const b = arrayCorners[(i + 1) % 4];
          segments.push({ a, b, axis: Math.abs(a.x - b.x) <= 1e-9 ? 'vertical' : 'horizontal' });
        }
      }

      // instances
      for (const inst of instances) {
        const rawCorners = getInstanceCorners(inst);
        if (!rawCorners) continue;
        const corners = rawCorners.map(c => editToBasePoint(c.x, c.y));
        for (let i=0; i<4; i++) {
          const a = corners[i];
          const b = corners[(i+1)%4];
          segments.push({ a, b, axis: Math.abs(a.x - b.x) <= 1e-9 ? 'vertical' : 'horizontal' });
        }
      }

      for (const seg of segments) {
        const closest = getClosestPointOnSegment({x: umX, y: umY}, seg.a, seg.b);
        if (closest.dist < snapRadiusUm) {
          if (!bestSnap || closest.dist < bestSnap.dist) {
            // Keep exact edge coordinate while locking the free axis along the edge onto the active grid.
            const minX = Math.min(seg.a.x, seg.b.x);
            const maxX = Math.max(seg.a.x, seg.b.x);
            const minY = Math.min(seg.a.y, seg.b.y);
            const maxY = Math.max(seg.a.y, seg.b.y);
            const lockedX = seg.axis === 'vertical'
              ? closest.x
              : Math.max(minX, Math.min(maxX, snapToGrid(closest.x, activeSnapStep)));
            const lockedY = seg.axis === 'horizontal'
              ? closest.y
              : Math.max(minY, Math.min(maxY, snapToGrid(closest.y, activeSnapStep)));
            bestSnap = { x: lockedX, y: lockedY, dist: closest.dist, snapEdgeAxis: seg.axis };
          }
        }
      }

      if (bestSnap) {
        return { umX: bestSnap.x, umY: bestSnap.y, isSnapped: true, snapEdgeAxis: bestSnap.snapEdgeAxis };
      }
    }

    const snapped = snapPointToGrid(umX, umY, activeSnapStep);
    return { umX: snapped.x, umY: snapped.y, isSnapped: false, snapEdgeAxis: undefined };
  };

  const commitRectDraft = (startX: number, startY: number, endX: number, endY: number): boolean => {
    const normalized = normalizeRectFromPoints(startX, startY, endX, endY, activeSnapStep, gridSize);
    if (!normalized) return false;
    try {
      addShape({
        layer: activeDrawLayer,
        purpose: activeDrawPurpose,
        x: normalized.x,
        y: normalized.y,
        width: normalized.width,
        height: normalized.height,
        ...(activeDrawColor ? { color: activeDrawColor } : {}),
        ...(activeDrawLabel.trim() ? { label: activeDrawLabel.trim() } : {}),
      });
      return true;
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to create rectangle.');
      return false;
    }
  };

  const snapBaseToEditPoint = (rawBaseX: number, rawBaseY: number) => {
    const snappedBase = snapPointToGrid(rawBaseX, rawBaseY, activeSnapStep);
    if (!isEditInPlace) return { base: snappedBase, edit: snappedBase };
    const mapped = baseToEditPoint(snappedBase.x, snappedBase.y);
    return { base: snappedBase, edit: snapPointToGrid(mapped.x, mapped.y, gridSize) };
  };

  const snapScreenDragPosForEdit = (pos: { x: number; y: number }) => {
    const baseX = ((pos.x - stagePos.x) / stageScale) / SCALE_FACTOR;
    const baseY = ((pos.y - stagePos.y) / -stageScale) / SCALE_FACTOR;
    const editRaw = baseToEditPoint(baseX, baseY);
    const editSnapped = snapPointToGrid(editRaw.x, editRaw.y, activeSnapStep);
    const baseBack = editToBasePoint(editSnapped.x, editSnapped.y);
    return {
      x: baseBack.x * SCALE_FACTOR * stageScale + stagePos.x,
      y: baseBack.y * SCALE_FACTOR * -stageScale + stagePos.y,
    };
  };

  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 1 || (e.evt.button === 0 && isSpaceDown)) {
      setPanStart({ x: e.evt.clientX, y: e.evt.clientY, stageX: stagePos.x, stageY: stagePos.y });
      setIsPanning(true);
      return;
    }

    if (appMode === 'stretch' && e.evt.button === 0) {
      const pointer = stageRef.current?.getPointerPosition();
      if (pointer) {
        const rawBaseX = ((pointer.x - stagePos.x) / stageScale) / SCALE_FACTOR;
        const rawBaseY = ((pointer.y - stagePos.y) / -stageScale) / SCALE_FACTOR;
        const rawEdit = baseToEditPoint(rawBaseX, rawBaseY);
        const { base: snappedBase, edit: snappedEdit } = snapBaseToEditPoint(rawBaseX, rawBaseY);
        setMousePos(snappedBase);

        // 1. Two-click stretch destination commit
        if (stretchSessionRef.current) {
          const active = stretchSessionRef.current;
          const updates = computeStretchedShapes(
            shapes,
            active.selection,
            snappedEdit.x - active.anchorX,
            snappedEdit.y - active.anchorY,
            activeSnapStep,
            gridSize,
          );
          stretchSessionRef.current = null;
          stretchDraggingRef.current = false;
          setStretchSession(null);
          try {
            batchUpdateShapes(updates);
          } catch (error) {
            alert(error instanceof Error ? error.message : 'Unable to stretch selected edges.');
          }
          updatePartialSelection({});
          ignoreBackgroundClickUntilRef.current = performance.now() + 100;
          return;
        }

        // 2. If edges are already partially selected (and not holding Shift to add more), start stretching from this anchor
        if (hasPartialSelection(partialSelectionRef.current) && !e.evt.shiftKey) {
          const nextSession = {
            anchorX: snappedEdit.x,
            anchorY: snappedEdit.y,
            currentX: snappedEdit.x,
            currentY: snappedEdit.y,
            selection: partialSelectionRef.current,
          };
          stretchSessionRef.current = nextSession;
          stretchDraggingRef.current = true;
          setStretchSession(nextSession);
          return;
        }

        // 3. Direct edge/corner click starts stretch immediately (or Shift-toggles edge into partial selection)
        const hitTolUm = 10 / (stageScale * SCALE_FACTOR);
        const hit = hitTestShapeEdgeOrCorner(shapes, rawEdit.x, rawEdit.y, hitTolUm);
        if (hit) {
          if (e.evt.shiftKey) {
            const nextSel = mergePartialSelections(partialSelectionRef.current, { [hit.shapeId]: hit.edges }, 'toggle');
            updatePartialSelection(nextSel);
            ignoreBackgroundClickUntilRef.current = performance.now() + 100;
            return;
          }
          const directSelection: PartialShapeSelection = { [hit.shapeId]: hit.edges };
          updatePartialSelection(directSelection);
          setSelectedShape(hit.shapeId);
          const nextSession = {
            anchorX: snappedEdit.x,
            anchorY: snappedEdit.y,
            currentX: snappedEdit.x,
            currentY: snappedEdit.y,
            selection: directSelection,
          };
          stretchSessionRef.current = nextSession;
          stretchDraggingRef.current = true;
          setStretchSession(nextSession);
          return;
        }

        // 4. Drag a Virtuoso partial-selection marquee across one or more shape edges/corners
        const nextBox = { startX: rawEdit.x, startY: rawEdit.y, currentX: rawEdit.x, currentY: rawEdit.y };
        partialMarqueeRef.current = nextBox;
        partialMarqueeDraggedRef.current = false;
        setPartialMarquee(nextBox);
      }
      return;
    }

    if (appMode === 'select' && partialSelectMode && !edgeAlignmentSession && e.evt.button === 0) {
      const pointer = stageRef.current?.getPointerPosition();
      if (pointer) {
        const rawBaseX = ((pointer.x - stagePos.x) / stageScale) / SCALE_FACTOR;
        const rawBaseY = ((pointer.y - stagePos.y) / -stageScale) / SCALE_FACTOR;
        const rawEdit = baseToEditPoint(rawBaseX, rawBaseY);
        const snappedBase = snapPointToGrid(rawBaseX, rawBaseY, activeSnapStep);
        setMousePos(snappedBase);
        const hitTolUm = 10 / (stageScale * SCALE_FACTOR);
        const hit = hitTestShapeEdgeOrCorner(shapes, rawEdit.x, rawEdit.y, hitTolUm);
        if (hit) {
          const nextSel = mergePartialSelections(
            partialSelectionRef.current,
            { [hit.shapeId]: hit.edges },
            e.evt.shiftKey ? 'toggle' : 'replace',
          );
          updatePartialSelection(nextSel);
          setSelectedInstance(null);
          setSelectedShape(hit.shapeId);
          ignoreBackgroundClickUntilRef.current = performance.now() + 100;
          return;
        }
        const nextBox = { startX: rawEdit.x, startY: rawEdit.y, currentX: rawEdit.x, currentY: rawEdit.y };
        partialMarqueeRef.current = nextBox;
        partialMarqueeDraggedRef.current = false;
        setPartialMarquee(nextBox);
      }
      return;
    }

    if (appMode === 'rect' && e.evt.button === 0) {
      const pointer = stageRef.current?.getPointerPosition();
      if (pointer) {
        const rawBaseX = ((pointer.x - stagePos.x) / stageScale) / SCALE_FACTOR;
        const rawBaseY = ((pointer.y - stagePos.y) / -stageScale) / SCALE_FACTOR;
        const { base: snappedBase, edit: snappedEdit } = snapBaseToEditPoint(rawBaseX, rawBaseY);
        setMousePos(snappedBase);
        if (rectDraftRef.current) {
          const existing = rectDraftRef.current;
          commitRectDraft(existing.startX, existing.startY, snappedEdit.x, snappedEdit.y);
          rectDraftRef.current = null;
          rectDraggingRef.current = false;
          setRectDraft(null);
          ignoreBackgroundClickUntilRef.current = performance.now() + 100;
        } else {
          const nextDraft = { startX: snappedEdit.x, startY: snappedEdit.y, currentX: snappedEdit.x, currentY: snappedEdit.y };
          rectDraftRef.current = nextDraft;
          rectDraggingRef.current = true;
          setRectDraft(nextDraft);
        }
      }
      return;
    }
    
    if (appMode === 'select' && e.evt.button === 0 && (e.target.name() === 'bg' || e.target === e.target.getStage())) {
      const pointer = stageRef.current?.getPointerPosition();
      if (pointer) {
        const rawBaseX = ((pointer.x - stagePos.x) / stageScale) / SCALE_FACTOR;
        const rawBaseY = ((pointer.y - stagePos.y) / -stageScale) / SCALE_FACTOR;
        const { base: snappedBase, edit: snappedEdit } = snapBaseToEditPoint(rawBaseX, rawBaseY);
        setMousePos(snappedBase);
        const nextSelectionBox = { startX: snappedEdit.x, startY: snappedEdit.y, currentX: snappedEdit.x, currentY: snappedEdit.y };
        selectionBoxRef.current = nextSelectionBox;
        marqueeDraggedRef.current = false;
        setSelectionBox(nextSelectionBox);
      }
    }
  };

  const handleMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    if (panStart) {
      setStagePos({
        x: panStart.stageX + (e.evt.clientX - panStart.x),
        y: panStart.stageY + (e.evt.clientY - panStart.y),
      });
      return;
    }

    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;

    if (stretchSessionRef.current) {
      const rawBaseX = ((pointer.x - stagePos.x) / stageScale) / SCALE_FACTOR;
      const rawBaseY = ((pointer.y - stagePos.y) / -stageScale) / SCALE_FACTOR;
      const { base: snappedBase, edit: snappedEdit } = snapBaseToEditPoint(rawBaseX, rawBaseY);
      setMousePos(snappedBase);
      const nextSession = { ...stretchSessionRef.current, currentX: snappedEdit.x, currentY: snappedEdit.y };
      stretchSessionRef.current = nextSession;
      setStretchSession(nextSession);
      return;
    }

    if (partialMarqueeRef.current) {
      const rawBaseX = ((pointer.x - stagePos.x) / stageScale) / SCALE_FACTOR;
      const rawBaseY = ((pointer.y - stagePos.y) / -stageScale) / SCALE_FACTOR;
      const rawEdit = baseToEditPoint(rawBaseX, rawBaseY);
      setMousePos(snapPointToGrid(rawBaseX, rawBaseY, activeSnapStep));
      const nextBox = { ...partialMarqueeRef.current, currentX: rawEdit.x, currentY: rawEdit.y };
      partialMarqueeRef.current = nextBox;
      partialMarqueeDraggedRef.current ||= Math.hypot(
        (rawEdit.x - nextBox.startX) * SCALE_FACTOR * stageScale,
        (rawEdit.y - nextBox.startY) * SCALE_FACTOR * stageScale,
      ) >= MARQUEE_DRAG_THRESHOLD_PX;
      setPartialMarquee(nextBox);
      return;
    }

    if (rectDraftRef.current) {
      const rawBaseX = ((pointer.x - stagePos.x) / stageScale) / SCALE_FACTOR;
      const rawBaseY = ((pointer.y - stagePos.y) / -stageScale) / SCALE_FACTOR;
      const { base: snappedBase, edit: snappedEdit } = snapBaseToEditPoint(rawBaseX, rawBaseY);
      setMousePos(snappedBase);
      const nextDraft = { ...rectDraftRef.current, currentX: snappedEdit.x, currentY: snappedEdit.y };
      rectDraftRef.current = nextDraft;
      setRectDraft(nextDraft);
      return;
    }
    
    if (selectionBoxRef.current) {
      const rawBaseX = ((pointer.x - stagePos.x) / stageScale) / SCALE_FACTOR;
      const rawBaseY = ((pointer.y - stagePos.y) / -stageScale) / SCALE_FACTOR;
      const { base: snappedBase, edit: snappedEdit } = snapBaseToEditPoint(rawBaseX, rawBaseY);
      setMousePos(snappedBase);
      const nextSelectionBox = { ...selectionBoxRef.current, currentX: snappedEdit.x, currentY: snappedEdit.y };
      selectionBoxRef.current = nextSelectionBox;
      marqueeDraggedRef.current ||= Math.hypot(
        (snappedEdit.x - nextSelectionBox.startX) * SCALE_FACTOR * stageScale,
        (snappedEdit.y - nextSelectionBox.startY) * SCALE_FACTOR * stageScale,
      ) >= MARQUEE_DRAG_THRESHOLD_PX;
      setSelectionBox(nextSelectionBox);
      return;
    }

    const { umX, umY, isSnapped, snapEdgeAxis } = getSnappedWorldPos(pointer, appMode === 'measure');

    setMousePos({ x: umX, y: umY });

    if (appMode === 'stretch' || (appMode === 'select' && partialSelectMode && !edgeAlignmentSession)) {
      const rawBaseX = ((pointer.x - stagePos.x) / stageScale) / SCALE_FACTOR;
      const rawBaseY = ((pointer.y - stagePos.y) / -stageScale) / SCALE_FACTOR;
      const rawEdit = baseToEditPoint(rawBaseX, rawBaseY);
      const hit = hitTestShapeEdgeOrCorner(shapes, rawEdit.x, rawEdit.y, 10 / (stageScale * SCALE_FACTOR));
      setHoveredStretchHit(prev => {
        if (!prev && !hit) return prev;
        if (prev && hit && prev.shapeId === hit.shapeId && prev.kind === hit.kind && prev.edges.join(',') === hit.edges.join(',')) {
          return prev;
        }
        return hit;
      });
    } else if (hoveredStretchHit !== null) {
      setHoveredStretchHit(null);
    }
    
    if (appMode === 'measure' && isSnapped) {
      setSnapIndicator({ x: umX, y: umY });
    } else {
      setSnapIndicator(null);
    }

    if (appMode === 'measure' && isMeasuring && measureStart) {
      const editCursor = isEditInPlace ? baseToEditPoint(umX, umY) : { x: umX, y: umY };
      const editAxis: SnapEdgeAxis | undefined = isSnapped && snapEdgeAxis
        ? (isEditInPlace && ['R90', 'R270', 'MXR90', 'MYR90'].includes(eipInverseTransform.orientation)
            ? (snapEdgeAxis === 'vertical' ? 'horizontal' : 'vertical')
            : snapEdgeAxis)
        : undefined;
      const end = resolveOrthogonalRulerEnd(
        measureStart,
        { x: editCursor.x, y: editCursor.y, snapEdgeAxis: editAxis },
        orthogonalRuler,
      );
      
      setCurrentRuler({
        startX: measureStart.x,
        startY: measureStart.y,
        endX: end.x,
        endY: end.y,
        ...(end.referenceX !== undefined && end.referenceY !== undefined
          ? { referenceX: end.referenceX, referenceY: end.referenceY }
          : {}),
      });
    }
  };

  const finishMarqueeSelection = (shiftKey: boolean) => {
    const completedBox = selectionBoxRef.current;
    const wasDragged = marqueeDraggedRef.current;
    selectionBoxRef.current = null;
    marqueeDraggedRef.current = false;
    setSelectionBox(null);

    // A click that never crossed the drag threshold is handled by Stage.onClick.
    if (!completedBox || !wasDragged) return;

    const minX = Math.min(completedBox.startX, completedBox.currentX);
    const maxX = Math.max(completedBox.startX, completedBox.currentX);
    const minY = Math.min(completedBox.startY, completedBox.currentY);
    const maxY = Math.max(completedBox.startY, completedBox.currentY);
      
    const newSelectedIds: string[] = [];
      
    for (const inst of instances) {
      const bbox = computeInstanceBBox(inst);
      if (bbox) {
        if (bbox.minX >= minX && bbox.maxX <= maxX && bbox.minY >= minY && bbox.maxY <= maxY) {
          newSelectedIds.push(inst.id);
        }
      }
    }
      
    const state = useStore.getState();
    if (newSelectedIds.length > 0) {
      if (shiftKey) {
        state.setSelection([...new Set([...state.selectedInstanceIds, ...newSelectedIds])]);
      } else {
        state.setSelection(newSelectedIds);
      }
    } else if (!shiftKey) {
      state.setSelectedInstance(null);
    }

    // Konva emits click after mouseup on the same background gesture. Without
    // this guard, Stage.onClick immediately clears the selection made above.
    ignoreBackgroundClickUntilRef.current = performance.now() + 100;
  };

  const finishPartialMarquee = (shiftKey: boolean) => {
    const completedBox = partialMarqueeRef.current;
    const wasDragged = partialMarqueeDraggedRef.current;
    partialMarqueeRef.current = null;
    partialMarqueeDraggedRef.current = false;
    setPartialMarquee(null);

    if (!completedBox) return;
    if (!wasDragged) {
      if (!shiftKey) {
        updatePartialSelection({});
      }
      return;
    }

    const picked = selectShapeEdgesInBox(shapes, {
      minX: Math.min(completedBox.startX, completedBox.currentX),
      maxX: Math.max(completedBox.startX, completedBox.currentX),
      minY: Math.min(completedBox.startY, completedBox.currentY),
      maxY: Math.max(completedBox.startY, completedBox.currentY),
    });
    const next = mergePartialSelections(
      partialSelectionRef.current,
      picked,
      shiftKey ? 'toggle' : 'replace',
    );
    updatePartialSelection(next);
    if (hasPartialSelection(next)) {
      setSelectedInstance(null);
      const firstId = Object.keys(next)[0];
      if (firstId) setSelectedShape(firstId);
    }
    ignoreBackgroundClickUntilRef.current = performance.now() + 100;
  };

  const handleMouseUp = (e: KonvaEventObject<MouseEvent>) => {
    if (panStart) {
      setPanStart(null);
      setIsPanning(false);
      return;
    }
    if (stretchSessionRef.current && stretchDraggingRef.current) {
      stretchDraggingRef.current = false;
      const active = stretchSessionRef.current;
      const dx = active.currentX - active.anchorX;
      const dy = active.currentY - active.anchorY;
      // If the user dragged across at least one snap step, commit immediately; otherwise stay in Virtuoso two-click stretch mode.
      if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
        const updates = computeStretchedShapes(shapes, active.selection, dx, dy, activeSnapStep, gridSize);
        stretchSessionRef.current = null;
        setStretchSession(null);
        try {
          batchUpdateShapes(updates);
        } catch (error) {
          alert(error instanceof Error ? error.message : 'Unable to stretch selected edges.');
        }
        updatePartialSelection({});
        ignoreBackgroundClickUntilRef.current = performance.now() + 100;
      }
      return;
    }
    if (partialMarqueeRef.current) {
      finishPartialMarquee(e.evt.shiftKey);
      return;
    }
    if (rectDraftRef.current && rectDraggingRef.current) {
      rectDraggingRef.current = false;
      const draft = rectDraftRef.current;
      // If user dragged out a non-zero rectangle, commit immediately; otherwise keep first corner for two-click Virtuoso mode.
      if (commitRectDraft(draft.startX, draft.startY, draft.currentX, draft.currentY)) {
        rectDraftRef.current = null;
        setRectDraft(null);
        ignoreBackgroundClickUntilRef.current = performance.now() + 100;
      }
      return;
    }
    finishMarqueeSelection(e.evt.shiftKey);
  };

  const handleMouseLeave = (e: KonvaEventObject<MouseEvent>) => {
    setMousePos(null);
    setHoveredStretchHit(null);
    if (panStart) {
      setPanStart(null);
      setIsPanning(false);
    }
    if (stretchDraggingRef.current) {
      stretchDraggingRef.current = false;
      stretchSessionRef.current = null;
      setStretchSession(null);
    }
    if (partialMarqueeRef.current) {
      finishPartialMarquee(e.evt?.shiftKey ?? false);
    }
    if (rectDraggingRef.current) {
      rectDraggingRef.current = false;
    }
    finishMarqueeSelection(e.evt?.shiftKey ?? false);
  };

  const handleDragStart = (inst: Instance) => {
    if (selectedInstanceIds.length <= 1 || !selectedInstanceIds.includes(inst.id)) {
      multiDragBoundsRef.current = null;
      setMultiDragDelta(null);
      return;
    }

    const halfW = topWidth / 2;
    const halfH = topHeight / 2;
    const padHalfW = halfW - padInset;
    const padHalfH = halfH - padInset;
    let minDx = -Infinity;
    let maxDx = Infinity;
    let minDy = -Infinity;
    let maxDy = Infinity;

    for (const id of selectedInstanceIds) {
      const item = instances.find(candidate => candidate.id === id);
      if (!item) continue;
      const master = masterCells[item.cellId];
      if (!master) continue;
      const bounds = getPhysicalBounds({
        ...item,
        width: master.width,
        height: master.height,
        originX: master.originX,
        originY: master.originY,
      });
      if (isSubCellCanvas) {
        // Sub-cell layout canvases are unbounded around (0, 0)
        continue;
      }
      if (master.kind === 'pad') {
        const onTopOrBottom = Math.abs(bounds.top - padHalfH) <= 1e-6 || Math.abs(bounds.bottom + padHalfH) <= 1e-6;
        const onLeftOrRight = Math.abs(bounds.left + padHalfW) <= 1e-6 || Math.abs(bounds.right - padHalfW) <= 1e-6;
        minDx = Math.max(minDx, -padHalfW - bounds.left);
        maxDx = Math.min(maxDx, padHalfW - bounds.right);
        minDy = Math.max(minDy, -padHalfH - bounds.bottom);
        maxDy = Math.min(maxDy, padHalfH - bounds.top);
        if (onTopOrBottom && !onLeftOrRight) {
          minDy = Math.max(minDy, 0);
          maxDy = Math.min(maxDy, 0);
        } else if (onLeftOrRight && !onTopOrBottom) {
          minDx = Math.max(minDx, 0);
          maxDx = Math.min(maxDx, 0);
        }
      } else {
        minDx = Math.max(minDx, -halfW - bounds.left);
        maxDx = Math.min(maxDx, halfW - bounds.right);
        minDy = Math.max(minDy, -halfH - bounds.bottom);
        maxDy = Math.min(maxDy, halfH - bounds.top);
      }
    }

    multiDragBoundsRef.current = {
      anchorId: inst.id,
      startX: inst.x,
      startY: inst.y,
      minDx,
      maxDx,
      minDy,
      maxDy,
    };
    setMultiDragDelta({ anchorId: inst.id, dx: 0, dy: 0 });
  };

  // Drag bound logic: clamp physical bounds inside top cell and snap to exact grid steps
  const dragBoundFunc = (pos: {x: number, y: number}, cellId: string, orientation: string, instanceId: string) => {
    const master = masterCells[cellId];
    if (!master) return pos;

    const worldX = (pos.x - stagePos.x) / stageScale;
    const worldY = (pos.y - stagePos.y) / -stageScale;
    const baseUmX = worldX / SCALE_FACTOR;
    const baseUmY = worldY / SCALE_FACTOR;
    const editPos = baseToEditPoint(baseUmX, baseUmY);
    const umX = editPos.x;
    const umY = editPos.y;

    const groupDrag = multiDragBoundsRef.current;
    if (groupDrag && groupDrag.anchorId === instanceId) {
      const snapDelta = (raw: number, min: number, max: number) => {
        const minStep = Math.ceil((min - 1e-9) / activeSnapStep);
        const maxStep = Math.floor((max + 1e-9) / activeSnapStep);
        if (minStep > maxStep) {
          const fineMin = Math.ceil((min - 1e-9) / gridSize);
          const fineMax = Math.floor((max + 1e-9) / gridSize);
          if (fineMin > fineMax) return 0;
          const fineStep = Math.max(fineMin, Math.min(Math.round(raw / gridSize), fineMax));
          return snapToGrid(fineStep * gridSize, gridSize);
        }
        const step = Math.max(minStep, Math.min(Math.round(raw / activeSnapStep), maxStep));
        return snapToGrid(step * activeSnapStep, gridSize);
      };
      const dx = snapDelta(umX - groupDrag.startX, groupDrag.minDx, groupDrag.maxDx);
      const dy = snapDelta(umY - groupDrag.startY, groupDrag.minDy, groupDrag.maxDy);
      const baseBack = editToBasePoint(groupDrag.startX + dx, groupDrag.startY + dy);
      return {
        x: baseBack.x * SCALE_FACTOR * stageScale + stagePos.x,
        y: baseBack.y * SCALE_FACTOR * -stageScale + stagePos.y,
      };
    }

    try {
      const snapped = isSubCellCanvas
        ? snapPointToGrid(umX, umY, activeSnapStep)
        : master.kind === 'pad'
          ? snapPadToNearestEdge(
              umX,
              umY,
              master.width,
              master.height,
              topWidth,
              topHeight,
              gridSize,
              orientation,
              padInset,
              master.originX ?? 0,
              master.originY ?? 0,
            )
          : clampWithSnapStep(
              umX,
              umY,
              orientation,
              master.width,
              master.height,
              master.originX ?? 0,
              master.originY ?? 0,
            );
      const baseBack = editToBasePoint(snapped.x, snapped.y);
      return {
        x: baseBack.x * SCALE_FACTOR * stageScale + stagePos.x,
        y: baseBack.y * SCALE_FACTOR * -stageScale + stagePos.y,
      };
    } catch {
      return pos;
    }
  };

  const handleDragMove = (e: KonvaEventObject<DragEvent>, instanceId: string) => {
    const groupDrag = multiDragBoundsRef.current;
    if (!groupDrag || groupDrag.anchorId !== instanceId) return;
    const dx = snapToGrid(e.target.x() / SCALE_FACTOR - groupDrag.startX, gridSize);
    const dy = snapToGrid(e.target.y() / SCALE_FACTOR - groupDrag.startY, gridSize);
    setMultiDragDelta(prev => (
      prev && prev.anchorId === instanceId && prev.dx === dx && prev.dy === dy
        ? prev
        : { anchorId: instanceId, dx, dy }
    ));
  };

  const clampBoxInsideActiveBoundary = (x: number, y: number, width: number, height: number, step: number) => {
    const snapAxis = (val: number, min: number, max: number, grid: number) => {
      const minStep = Math.ceil((min - 1e-9) / grid);
      const maxStep = Math.floor((max + 1e-9) / grid);
      if (minStep > maxStep) throw new RangeError('Does not fit inside active cell');
      const idx = Math.max(minStep, Math.min(Math.round(val / grid), maxStep));
      const snapped = snapToGrid(idx * grid, grid);
      return Object.is(snapped, -0) ? 0 : snapped;
    };
    const minX = activeBoundaryBox.minX;
    const maxX = activeBoundaryBox.maxX - width;
    const minY = activeBoundaryBox.minY;
    const maxY = activeBoundaryBox.maxY - height;
    try {
      return {
        x: snapAxis(x, minX, maxX, step),
        y: snapAxis(y, minY, maxY, step),
      };
    } catch {
      return {
        x: snapAxis(x, minX, maxX, gridSize),
        y: snapAxis(y, minY, maxY, gridSize),
      };
    }
  };

  const pixelArrayDragBoundFunc = (pos: { x: number; y: number }) => {
    if (!pixelArray) return pos;
    const worldX = (pos.x - stagePos.x) / stageScale;
    const worldY = (pos.y - stagePos.y) / -stageScale;
    const editPos = baseToEditPoint(worldX / SCALE_FACTOR, worldY / SCALE_FACTOR);
    try {
      const snapped = clampBoxInsideActiveBoundary(
        editPos.x,
        editPos.y,
        pixelArray.width,
        pixelArray.height,
        activeSnapStep,
      );
      const baseBack = editToBasePoint(snapped.x, snapped.y);
      return {
        x: baseBack.x * SCALE_FACTOR * stageScale + stagePos.x,
        y: baseBack.y * SCALE_FACTOR * -stageScale + stagePos.y,
      };
    } catch {
      return pos;
    }
  };

  const handleDragEnd = (e: KonvaEventObject<DragEvent>, instanceId: string) => {
    const node = e.target;
    const groupDrag = multiDragBoundsRef.current;
    if (groupDrag && groupDrag.anchorId === instanceId) {
      multiDragBoundsRef.current = null;
      setMultiDragDelta(null);
      const dx = snapToGrid(node.x() / SCALE_FACTOR - groupDrag.startX, gridSize);
      const dy = snapToGrid(node.y() / SCALE_FACTOR - groupDrag.startY, gridSize);
      if (Math.abs(dx) <= 1e-12 && Math.abs(dy) <= 1e-12) {
        node.x(groupDrag.startX * SCALE_FACTOR);
        node.y(groupDrag.startY * SCALE_FACTOR);
        return;
      }
      try {
        moveInstancesByDelta(selectedInstanceIds, dx, dy);
      } catch (error) {
        node.x(groupDrag.startX * SCALE_FACTOR);
        node.y(groupDrag.startY * SCALE_FACTOR);
        alert(error instanceof Error ? error.message : 'Unable to move the selected blocks.');
      }
      return;
    }
    const umX = node.x() / SCALE_FACTOR;
    const umY = node.y() / SCALE_FACTOR;
    const original = instances.find(item => item.id === instanceId);
    try {
      updateInstancePosition(instanceId, umX, umY);
    } catch (error) {
      if (original) {
        node.x(original.x * SCALE_FACTOR);
        node.y(original.y * SCALE_FACTOR);
      }
      alert(error instanceof Error ? error.message : 'Unable to move the selected block.');
    }
  };

  const overlapViolations = useMemo(
    () => (showOverlapDrc ? findOverlapViolations({ masterCells, instances }) : []),
    [showOverlapDrc, masterCells, instances],
  );

  // ----------------------------------------------------------------
  // Gap annotation helpers
  // ----------------------------------------------------------------
  type BBox = { minX: number; maxX: number; minY: number; maxY: number };

  const computeInstanceBBox = (inst: Instance): BBox | null => {
    const m = masterCells[inst.cellId];
    if (!m) return null;
    const bounds = getPhysicalBounds({
      ...inst,
      width: m.width,
      height: m.height,
      originX: m.originX,
      originY: m.originY,
    });
    return {
      minX: bounds.left,
      maxX: bounds.right,
      minY: bounds.bottom,
      maxY: bounds.top,
    };
  };

  const sortedInstances = useMemo(() => (
    [...instances].sort((a, b) => {
      const mA = masterCells[a.cellId];
      const mB = masterCells[b.cellId];
      if (!mA || !mB) return 0;
      return (mB.width * mB.height) - (mA.width * mA.height);
    })
  ), [instances, masterCells]);

  const renderGapAnnotations = (selectedId: string | null, autoMode: boolean) => {
    const sf = SCALE_FACTOR;
    const SEL_COLOR = '#0284c7';
    const SEL_BG = 'rgba(240, 249, 255, 0.94)';
    const SEL_BORDER = 'rgba(14, 165, 233, 0.55)';
    const AUTO_COLOR = '#6d28d9';
    const AUTO_LINE = '#8b5cf6';
    const AUTO_BG = 'rgba(245, 243, 255, 0.94)';
    const AUTO_BORDER = 'rgba(139, 92, 246, 0.45)';
    const placedLabelRects: ScreenLabelRect[] = [];
    const annotations: React.ReactNode[] = [];
    const topBox: BBox = activeBoundaryBox;

    type DimSpec = {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      label: string;
      hoverLabel?: string;
      key: string;
      perpDir: 'up' | 'down' | 'left' | 'right';
      interactive: boolean;
      variant: 'selected' | 'auto';
    };

    const renderDimSpec = (spec: DimSpec, skipCollisionCheck = false) => {
      const p1 = editToBasePoint(spec.x1, spec.y1);
      const p2 = editToBasePoint(spec.x2, spec.y2);
      const x1 = p1.x;
      const y1 = p1.y;
      const x2 = p2.x;
      const y2 = p2.y;
      const { key, interactive, variant } = spec;
      const perpDir = isEditInPlace
        ? (() => {
            const vec = spec.perpDir === 'up'
              ? [0, 1]
              : spec.perpDir === 'down'
                ? [0, -1]
                : spec.perpDir === 'right'
                  ? [1, 0]
                  : [-1, 0];
            const mapped = applyCadenceOrientationVector(eipForwardTransform.orientation, vec[0], vec[1]);
            if (Math.abs(mapped.dx) > Math.abs(mapped.dy)) {
              return mapped.dx >= 0 ? 'right' : 'left';
            }
            return mapped.dy >= 0 ? 'up' : 'down';
          })()
        : spec.perpDir;
      const isHoriz = Math.abs(y2 - y1) < 0.0001;
      const isVert = Math.abs(x2 - x1) < 0.0001;
      const tickLen = 5 / stageScale;
      const isHovered = interactive && hoveredAutoDimKey === key;
      const isMuted = interactive && hoveredAutoDimKey !== null && !isHovered;

      const lineColor = variant === 'selected' ? '#0ea5e9' : AUTO_LINE;
      const textColor = variant === 'selected' ? SEL_COLOR : AUTO_COLOR;
      const pillBg = variant === 'selected' ? SEL_BG : AUTO_BG;
      const pillBorder = variant === 'selected' ? SEL_BORDER : AUTO_BORDER;
      const activeLabel = isHovered && spec.hoverLabel ? spec.hoverLabel : spec.label;

      const fs = (isHovered ? 11.5 : 10.5) / stageScale;
      const padX = 6 / stageScale;
      const padY = 3 / stageScale;
      const textW = Math.max(28 / stageScale, activeLabel.length * fs * 0.57);
      const pillW = textW + padX * 2;
      const pillH = fs + padY * 2;

      const mx = ((x1 + x2) / 2) * sf;
      const my = ((y1 + y2) / 2) * sf;
      const spanScreenPx = Math.hypot((x2 - x1) * sf, (y2 - y1) * sf) * stageScale;

      let lx = mx;
      let ly = my;
      if (isHoriz && spanScreenPx < pillW * stageScale + 14) {
        ly = my + (perpDir === 'down' ? -(pillH * 0.78 + 4 / stageScale) : (pillH * 0.78 + 4 / stageScale));
      } else if (isVert && spanScreenPx < pillH * stageScale + 14) {
        lx = mx + (perpDir === 'left' ? -(pillW * 0.56 + 6 / stageScale) : (pillW * 0.56 + 6 / stageScale));
      }

      const labelBox: ScreenLabelRect = {
        cx: lx * stageScale,
        cy: ly * stageScale,
        halfWidth: (pillW * stageScale) / 2 + 4,
        halfHeight: (pillH * stageScale) / 2 + 3,
      };
      const collides = !skipCollisionCheck && !isHovered && placedLabelRects.some(box => labelRectsOverlap(box, labelBox));
      const showPill = isHovered || !collides;
      if (showPill && !isHovered) {
        placedLabelRects.push(labelBox);
      }

      const strokeWidth = (isHovered ? 1.8 : 1.1) / stageScale;

      return (
        <Group
          key={key}
          listening={interactive}
          opacity={isMuted ? 0.18 : 1}
          onMouseEnter={interactive ? () => setHoveredAutoDimKey(key) : undefined}
          onMouseLeave={interactive ? () => setHoveredAutoDimKey(null) : undefined}
        >
          <Line
            points={[x1 * sf, y1 * sf, x2 * sf, y2 * sf]}
            stroke={lineColor}
            strokeWidth={strokeWidth}
            dash={[4 / stageScale, 4 / stageScale]}
            hitStrokeWidth={interactive ? 14 / stageScale : undefined}
          />
          {isHoriz && <>
            <Line points={[x1 * sf, y1 * sf - tickLen, x1 * sf, y1 * sf + tickLen]} stroke={lineColor} strokeWidth={1.1 / stageScale} listening={false} />
            <Line points={[x2 * sf, y2 * sf - tickLen, x2 * sf, y2 * sf + tickLen]} stroke={lineColor} strokeWidth={1.1 / stageScale} listening={false} />
          </>}
          {isVert && <>
            <Line points={[x1 * sf - tickLen, y1 * sf, x1 * sf + tickLen, y1 * sf]} stroke={lineColor} strokeWidth={1.1 / stageScale} listening={false} />
            <Line points={[x2 * sf - tickLen, y2 * sf, x2 * sf + tickLen, y2 * sf]} stroke={lineColor} strokeWidth={1.1 / stageScale} listening={false} />
          </>}
          {showPill && (
            <Group x={lx} y={ly} scaleY={-1} listening={interactive}>
              <Rect
                x={-pillW / 2}
                y={-pillH / 2}
                width={pillW}
                height={pillH}
                cornerRadius={pillH / 2}
                fill={pillBg}
                stroke={pillBorder}
                strokeWidth={1 / stageScale}
              />
              <Text
                x={-pillW / 2}
                y={-pillH / 2}
                width={pillW}
                height={pillH}
                text={activeLabel}
                fill={textColor}
                fontSize={fs}
                fontFamily={CANVAS_FONT_SANS}
                fontStyle="600"
                align="center"
                verticalAlign="middle"
                listening={false}
              />
            </Group>
          )}
        </Group>
      );
    };

    const snapLabel = (v: number) => `${formatGridValue(v, gridSize)} µm`;

    type Interval = { start: number; end: number };

    const subtractCoveredIntervals = (interval: Interval, covered: Interval[]) => {
      let visible = [interval];

      covered.forEach(blocked => {
        visible = visible.flatMap(segment => {
          if (blocked.end <= segment.start || blocked.start >= segment.end) {
            return [segment];
          }

          const remainder: Interval[] = [];
          if (blocked.start > segment.start) {
            remainder.push({ start: segment.start, end: blocked.start });
          }
          if (blocked.end < segment.end) {
            remainder.push({ start: blocked.end, end: segment.end });
          }
          return remainder;
        });
      });

      return visible.filter(segment => segment.end - segment.start > 0.0001);
    };

    const addCoveredInterval = (covered: Interval[], interval: Interval) => {
      const sorted = [...covered, interval].sort((a, b) => a.start - b.start);
      const merged: Interval[] = [];

      sorted.forEach(segment => {
        const previous = merged[merged.length - 1];
        if (!previous || segment.start > previous.end + 0.0001) {
          merged.push({ ...segment });
        } else {
          previous.end = Math.max(previous.end, segment.end);
        }
      });

      return merged;
    };

    if (selectedId) {
      const sel = instances.find(i => i.id === selectedId);
      if (sel) {
        const selBox = computeInstanceBBox(sel);
        const selIsPad = masterCells[sel.cellId]?.kind === 'pad';
        if (selBox) {
          const others = instances
            .filter(i => i.id !== selectedId)
            .map(i => ({
              id: i.id,
              name: i.name,
              isPad: masterCells[i.cellId]?.kind === 'pad',
              box: computeInstanceBBox(i),
            }))
            .filter(x => x.box !== null) as { id: string; name: string; isPad: boolean; box: BBox }[];

          type Direction = 'right' | 'left' | 'top' | 'bottom';

          const renderVisibleNeighbors = (direction: Direction) => {
            const horizontal = direction === 'right' || direction === 'left';
            const projectionStart = horizontal ? selBox.minY : selBox.minX;
            const projectionEnd = horizontal ? selBox.maxY : selBox.maxX;

            const rawInstanceCandidates = others.flatMap(other => {
              const ob = other.box;
              let distance: number;

              if (direction === 'right') distance = ob.minX - selBox.maxX;
              else if (direction === 'left') distance = selBox.minX - ob.maxX;
              else if (direction === 'top') distance = ob.minY - selBox.maxY;
              else distance = selBox.minY - ob.maxY;

              if (distance < -0.0001) return [];

              const overlapStart = Math.max(
                projectionStart,
                horizontal ? ob.minY : ob.minX,
              );
              const overlapEnd = Math.min(
                projectionEnd,
                horizontal ? ob.maxY : ob.maxX,
              );
              if (overlapEnd - overlapStart <= 0.0001) return [];

              return [{
                ...other,
                distance,
                overlap: { start: overlapStart, end: overlapEnd },
                occludes: true,
                relationship: 'gap' as const,
              }];
            });

            // Collapse collinear equal-distance pads into a single clearance dimension when an IP is selected
            const instanceCandidates = selIsPad
              ? rawInstanceCandidates
              : collapseCollinearPadCandidates(rawInstanceCandidates);

            const pixelCandidates = pixelArray?.visible ? (() => {
              const pixelBox: BBox = {
                minX: pixelArray.x,
                maxX: pixelArray.x + pixelArray.width,
                minY: pixelArray.y,
                maxY: pixelArray.y + pixelArray.height,
              };
              const measurement = getIpPixelArrayEdgeMeasurements(selBox, pixelBox)
                .find(item => item.direction === direction);
              if (!measurement) return [];
              const targetBox = { ...pixelBox };
              if (direction === 'right') targetBox.minX = measurement.arrayCoordinate;
              else if (direction === 'left') targetBox.maxX = measurement.arrayCoordinate;
              else if (direction === 'top') targetBox.minY = measurement.arrayCoordinate;
              else targetBox.maxY = measurement.arrayCoordinate;

              return [{
                id: 'pixel-array',
                name: 'Pixel Array',
                isPad: false,
                box: targetBox,
                distance: measurement.distance,
                overlap: { start: measurement.projectionStart, end: measurement.projectionEnd },
                occludes: false,
                relationship: measurement.kind,
              }];
            })() : [];

            const candidates = [...instanceCandidates, ...pixelCandidates]
              .sort((a, b) => a.distance - b.distance);

            let covered: Interval[] = [];
            let hasVisibleNeighbor = false;

            candidates.forEach(candidate => {
              const visibleSegments = subtractCoveredIntervals(candidate.overlap, covered);
              if (visibleSegments.length === 0) return;

              hasVisibleNeighbor = true;
              const largestVisibleSegment = visibleSegments.reduce((largest, segment) =>
                segment.end - segment.start > largest.end - largest.start ? segment : largest,
              );
              const projectionCenter = (largestVisibleSegment.start + largestVisibleSegment.end) / 2;

              if (candidate.distance > 0.0001) {
                const label = candidate.relationship === 'overlap'
                  ? `${snapLabel(candidate.distance)} overlap`
                  : candidate.relationship === 'inside'
                    ? `${snapLabel(candidate.distance)} to array`
                    : `${snapLabel(candidate.distance)} → ${candidate.name}`;
                const key = `gap-${direction}-${candidate.id}`;

                if (direction === 'right') {
                  annotations.push(renderDimSpec({ x1: selBox.maxX, y1: projectionCenter, x2: candidate.box.minX, y2: projectionCenter, label, key, perpDir: 'up', interactive: false, variant: 'selected' }, true));
                } else if (direction === 'left') {
                  annotations.push(renderDimSpec({ x1: candidate.box.maxX, y1: projectionCenter, x2: selBox.minX, y2: projectionCenter, label, key, perpDir: 'up', interactive: false, variant: 'selected' }, true));
                } else if (direction === 'top') {
                  annotations.push(renderDimSpec({ x1: projectionCenter, y1: selBox.maxY, x2: projectionCenter, y2: candidate.box.minY, label, key, perpDir: 'right', interactive: false, variant: 'selected' }, true));
                } else {
                  annotations.push(renderDimSpec({ x1: projectionCenter, y1: candidate.box.maxY, x2: projectionCenter, y2: selBox.minY, label, key, perpDir: 'right', interactive: false, variant: 'selected' }, true));
                }
              }

              if (candidate.occludes) covered = addCoveredInterval(covered, candidate.overlap);
            });

            if (!hasVisibleNeighbor && !isSubCellCanvas) {
              const projectionCenter = (projectionStart + projectionEnd) / 2;
              if (direction === 'right') {
                const gap = topBox.maxX - selBox.maxX;
                if (gap > 0.0001) annotations.push(renderDimSpec({ x1: selBox.maxX, y1: projectionCenter, x2: topBox.maxX, y2: projectionCenter, label: snapLabel(gap), key: 'gap-right-boundary', perpDir: 'up', interactive: false, variant: 'selected' }, true));
              } else if (direction === 'left') {
                const gap = selBox.minX - topBox.minX;
                if (gap > 0.0001) annotations.push(renderDimSpec({ x1: topBox.minX, y1: projectionCenter, x2: selBox.minX, y2: projectionCenter, label: snapLabel(gap), key: 'gap-left-boundary', perpDir: 'up', interactive: false, variant: 'selected' }, true));
              } else if (direction === 'top') {
                const gap = topBox.maxY - selBox.maxY;
                if (gap > 0.0001) annotations.push(renderDimSpec({ x1: projectionCenter, y1: selBox.maxY, x2: projectionCenter, y2: topBox.maxY, label: snapLabel(gap), key: 'gap-top-boundary', perpDir: 'right', interactive: false, variant: 'selected' }, true));
              } else {
                const gap = selBox.minY - topBox.minY;
                if (gap > 0.0001) annotations.push(renderDimSpec({ x1: projectionCenter, y1: topBox.minY, x2: projectionCenter, y2: selBox.minY, label: snapLabel(gap), key: 'gap-bottom-boundary', perpDir: 'right', interactive: false, variant: 'selected' }, true));
              }
            }
          };

          renderVisibleNeighbors('right');
          renderVisibleNeighbors('left');
          renderVisibleNeighbors('top');
          renderVisibleNeighbors('bottom');
        }
      }
    }

    // Global Auto-Dim overview: focus on IP-to-IP gaps and collapsed IP-to-pad-row clearances,
    // excluding dense pad-to-pad clutter and culling overlapping screen-space labels.
    if (autoMode && !selectedId) {
      const allBoxes = instances
        .map(i => ({
          id: i.id,
          name: i.name,
          isPad: masterCells[i.cellId]?.kind === 'pad',
          box: computeInstanceBBox(i),
        }))
        .filter(x => x.box !== null) as { id: string; name: string; isPad: boolean; box: BBox }[];
      const seenPairs = new Set<string>();
      const specs: DimSpec[] = [];

      type AutoDirection = 'right' | 'left' | 'top' | 'bottom';
      allBoxes.filter(source => !source.isPad).forEach(source => {
        (['right', 'left', 'top', 'bottom'] as AutoDirection[]).forEach(direction => {
          const horizontal = direction === 'right' || direction === 'left';
          const rawTargets = allBoxes.flatMap(target => {
            if (source.id === target.id) return [];
            const overlapStart = Math.max(
              horizontal ? source.box.minY : source.box.minX,
              horizontal ? target.box.minY : target.box.minX,
            );
            const overlapEnd = Math.min(
              horizontal ? source.box.maxY : source.box.maxX,
              horizontal ? target.box.maxY : target.box.maxX,
            );
            if (overlapEnd - overlapStart <= 0.0001) return [];

            let distance: number;
            if (direction === 'right') distance = target.box.minX - source.box.maxX;
            else if (direction === 'left') distance = source.box.minX - target.box.maxX;
            else if (direction === 'top') distance = target.box.minY - source.box.maxY;
            else distance = source.box.minY - target.box.maxY;
            if (distance <= 0.0001) return [];

            return [{
              id: target.id,
              name: target.name,
              isPad: target.isPad,
              occludes: true,
              box: target.box,
              distance,
              overlap: { start: overlapStart, end: overlapEnd },
            }];
          });

          const collapsed = collapseCollinearPadCandidates(rawTargets);
          const nearest = collapsed[0];
          if (!nearest) return;

          const pairKey = nearest.isPad
            ? `${source.id}|${direction}|${nearest.id}`
            : [source.id, nearest.id].sort().join('|');
          if (seenPairs.has(pairKey)) return;
          seenPairs.add(pairKey);

          const projectionCenter = (nearest.overlap.start + nearest.overlap.end) / 2;
          const compactLabel = snapLabel(nearest.distance);
          const hoverLabel = `${source.name} ↔ ${nearest.name} · ${compactLabel}`;
          const key = `auto-${horizontal ? 'h' : 'v'}-${pairKey}`;

          if (direction === 'right') {
            specs.push({ x1: source.box.maxX, y1: projectionCenter, x2: nearest.box.minX, y2: projectionCenter, label: compactLabel, hoverLabel, key, perpDir: 'up', interactive: true, variant: 'auto' });
          } else if (direction === 'left') {
            specs.push({ x1: nearest.box.maxX, y1: projectionCenter, x2: source.box.minX, y2: projectionCenter, label: compactLabel, hoverLabel, key, perpDir: 'up', interactive: true, variant: 'auto' });
          } else if (direction === 'top') {
            specs.push({ x1: projectionCenter, y1: source.box.maxY, x2: projectionCenter, y2: nearest.box.minY, label: compactLabel, hoverLabel, key, perpDir: 'right', interactive: true, variant: 'auto' });
          } else {
            specs.push({ x1: projectionCenter, y1: nearest.box.maxY, x2: projectionCenter, y2: source.box.minY, label: compactLabel, hoverLabel, key, perpDir: 'right', interactive: true, variant: 'auto' });
          }
        });
      });

      // Render non-hovered dimensions first, then hovered on top so its pill is never occluded
      specs
        .sort((a, b) => Number(a.key === hoveredAutoDimKey) - Number(b.key === hoveredAutoDimKey))
        .forEach(spec => annotations.push(renderDimSpec(spec)));
    }

    return annotations;
  };


  const renderRuler = (r: { id?: string; startX: number, startY: number, endX: number, endY: number, referenceX?: number, referenceY?: number }, key: string, onDelete?: () => void) => {
    const pStart = editToBasePoint(r.startX, r.startY);
    const pEnd = editToBasePoint(r.endX, r.endY);
    const pRef = r.referenceX !== undefined && r.referenceY !== undefined
      ? editToBasePoint(r.referenceX, r.referenceY)
      : null;
    const sx = pStart.x * SCALE_FACTOR;
    const sy = pStart.y * SCALE_FACTOR;
    const ex = pEnd.x * SCALE_FACTOR;
    const ey = pEnd.y * SCALE_FACTOR;
    const referenceX = pRef ? pRef.x * SCALE_FACTOR : null;
    const referenceY = pRef ? pRef.y * SCALE_FACTOR : null;
    const hasReferenceExtension = referenceX !== null && referenceY !== null
      && (Math.abs(referenceX - ex) > 1e-6 || Math.abs(referenceY - ey) > 1e-6);
    const isHovered = r.id != null && hoveredRulerId === r.id;
    const rulerColor = isHovered ? '#fbbf24' : '#eab308';
    
    const dx = pEnd.x - pStart.x;
    const dy = pEnd.y - pStart.y;
    const dist = Math.hypot(dx, dy);
    
    const ticks = [];
    const texts = [];

    if (dist > 0.0001) {
      const ux = dx / dist;
      const uy = dy / dist;
      // Perpendicular vector for ticks and text offset
      const nx = -uy;
      const ny = ux;
      
      // Calculate adaptive tick spacing based on zoom level
      const targetScreenSpacing = 100; // Wider spacing for text legibility
      const rawSpacing = targetScreenSpacing / (SCALE_FACTOR * stageScale);
      const mag = Math.pow(10, Math.floor(Math.log10(rawSpacing)));
      const norm = rawSpacing / mag;
      
      let step = 1;
      if (norm > 7.5) step = 10;
      else if (norm > 3.5) step = 5;
      else if (norm > 1.5) step = 2;
      
      let tickSpacing = step * mag;
      
      // Clamp the minimum tick spacing to the grid size
      tickSpacing = Math.max(tickSpacing, gridSize);
      
      const numTicks = Math.floor(dist / tickSpacing);
      
      for (let i = 1; i <= numTicks; i++) {
        const tickDist = i * tickSpacing;
        if (tickDist >= dist - (tickSpacing * 0.1)) break;
        
        const tx = sx + ux * tickDist * SCALE_FACTOR;
        const ty = sy + uy * tickDist * SCALE_FACTOR;
        const tickLen = 6 / stageScale;
        
        // Intermediate tick line
        ticks.push(
          <Line 
            key={`tick-line-${key}-${i}`}
            points={[tx - nx * tickLen, ty - ny * tickLen, tx + nx * tickLen, ty + ny * tickLen]} 
            stroke={rulerColor} 
            strokeWidth={1 / stageScale} 
          />
        );
        
        // Intermediate tick text
        const strVal = formatGridValue(tickDist, gridSize);
        texts.push(
          <Text
            key={`tick-text-${key}-${i}`}
            x={tx + nx * 10 / stageScale}
            y={ty + ny * 10 / stageScale}
            text={strVal}
            fill={rulerColor}
            fontSize={12 / stageScale}
            fontFamily={CANVAS_FONT_MONO}
            scaleY={-1}
            offsetY={-6 / stageScale} // slight vertical centering tweak
          />
        );
      }
      
      // Start and End perpendicular ticks (End markers)
      const endTickLen = 9 / stageScale;
      ticks.push(
        <Line key={`start-tick-${key}`} points={[sx - nx * endTickLen, sy - ny * endTickLen, sx + nx * endTickLen, sy + ny * endTickLen]} stroke={rulerColor} strokeWidth={1 / stageScale} />
      );
      ticks.push(
        <Line key={`end-tick-${key}`} points={[ex - nx * endTickLen, ey - ny * endTickLen, ex + nx * endTickLen, ey + ny * endTickLen]} stroke={rulerColor} strokeWidth={1 / stageScale} />
      );

      // Start text (0)
      texts.push(
        <Text
          key={`start-text-${key}`}
          x={sx + nx * 10 / stageScale}
          y={sy + ny * 10 / stageScale}
          text="0"
          fill={rulerColor}
          fontSize={12 / stageScale}
          fontFamily={CANVAS_FONT_MONO}
          scaleY={-1}
          offsetY={-6 / stageScale}
        />
      );

      // End text (Total length)
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      const finalDist = formatGridValue(dist, gridSize);
      
      let endTextString = `L: ${finalDist}`;
      if (absDx > 0.0001 && absDy > 0.0001) {
        const finalDx = formatGridValue(absDx, gridSize);
        const finalDy = formatGridValue(absDy, gridSize);
        endTextString += ` | dX: ${finalDx} | dY: ${finalDy}`;
        
        // Draw right triangle dashed lines
        ticks.push(
          <Line key={`triangle-x-${key}`} points={[sx, sy, ex, sy]} stroke="#eab308" strokeWidth={1 / stageScale} dash={[4 / stageScale, 4 / stageScale]} opacity={0.5} />
        );
        ticks.push(
          <Line key={`triangle-y-${key}`} points={[ex, sy, ex, ey]} stroke="#eab308" strokeWidth={1 / stageScale} dash={[4 / stageScale, 4 / stageScale]} opacity={0.5} />
        );
      }

      texts.push(
        <Text
          key={`end-text-${key}`}
          x={ex + nx * 10 / stageScale}
          y={ey + ny * 10 / stageScale}
          text={endTextString}
          fill={rulerColor}
          fontSize={12 / stageScale}
          fontStyle="normal"
          fontFamily={CANVAS_FONT_MONO}
          scaleY={-1}
          offsetY={-7 / stageScale}
        />
      );
    }

    return (
      <Group
        key={key}
        onMouseEnter={onDelete ? () => setHoveredRulerId(r.id ?? null) : undefined}
        onMouseLeave={onDelete ? () => setHoveredRulerId(null) : undefined}
        onClick={onDelete ? (e) => {
          e.cancelBubble = true;
          onDelete();
          setHoveredRulerId(null);
        } : undefined}
      >
        {/* Wide transparent hit area for easy clicking */}
        {onDelete && (
          <>
            <Line
              points={[sx, sy, ex, ey]}
              stroke="transparent"
              strokeWidth={14 / stageScale}
              hitStrokeWidth={14 / stageScale}
            />
            {hasReferenceExtension && (
              <Line
                points={[ex, ey, referenceX, referenceY]}
                stroke="transparent"
                strokeWidth={14 / stageScale}
                hitStrokeWidth={14 / stageScale}
              />
            )}
          </>
        )}
        {/* Main Line */}
        <Line points={[sx, sy, ex, ey]} stroke={rulerColor} strokeWidth={isHovered ? 2 / stageScale : 1 / stageScale} listening={false} />
        {hasReferenceExtension && (
          <>
            <Line
              points={[ex, ey, referenceX, referenceY]}
              stroke={rulerColor}
              strokeWidth={isHovered ? 2 / stageScale : 1 / stageScale}
              opacity={0.8}
              listening={false}
            />
            <Circle
              x={referenceX}
              y={referenceY}
              radius={3 / stageScale}
              fill={rulerColor}
              stroke="#ffffff"
              strokeWidth={1 / stageScale}
              listening={false}
            />
          </>
        )}
        {/* Ticks and Markers */}
        {ticks}
        {/* Texts */}
        {texts}
        {/* Delete hint on hover */}
        {isHovered && onDelete && (
          <Text
            x={(sx + ex) / 2}
            y={(sy + ey) / 2}
            text="✕ click to delete"
            fill="#fbbf24"
            fontSize={11 / stageScale}
            fontFamily={CANVAS_FONT_SANS}
            scaleY={-1}
            offsetY={-5 / stageScale}
            offsetX={0}
            align="center"
            listening={false}
          />
        )}
      </Group>
    );
  };

  const tw = baseWidth * SCALE_FACTOR;
  const th = baseHeight * SCALE_FACTOR;
  const boundaryX = baseBoundaryBox.minX * SCALE_FACTOR;
  const boundaryY = baseBoundaryBox.minY * SCALE_FACTOR;
  const axisExtent = Math.max(
    tw,
    th,
    (gridExtentUm.maxX - gridExtentUm.minX) * SCALE_FACTOR,
    (gridExtentUm.maxY - gridExtentUm.minY) * SCALE_FACTOR,
    100000,
  ) * 2;
  const bgExtent = axisExtent * 6;

  const gridGeometry = useMemo(() => {
    if (!showGrid || stageScale <= 0) {
      return {
        lines: [] as Array<{ key: string; points: number[]; major: boolean }>,
        dots: [] as Array<{ key: string; x: number; y: number }>,
      };
    }
    const { minorStep, majorStep, showFineDots } = displayGrid;
    const lines: Array<{ key: string; points: number[]; major: boolean }> = [];
    const hasViewport = dimensions.width > 1 && dimensions.height > 1;
    const viewLeftUm = hasViewport ? (-stagePos.x / stageScale) / SCALE_FACTOR : gridExtentUm.minX;
    const viewRightUm = hasViewport ? ((dimensions.width - stagePos.x) / stageScale) / SCALE_FACTOR : gridExtentUm.maxX;
    const viewTopUm = hasViewport ? (stagePos.y / stageScale) / SCALE_FACTOR : gridExtentUm.maxY;
    const viewBottomUm = hasViewport ? ((stagePos.y - dimensions.height) / stageScale) / SCALE_FACTOR : gridExtentUm.minY;
    const gxMin = !baseIsRoot ? viewLeftUm : gridExtentUm.minX;
    const gxMax = !baseIsRoot ? viewRightUm : gridExtentUm.maxX;
    const gyMin = !baseIsRoot ? viewBottomUm : gridExtentUm.minY;
    const gyMax = !baseIsRoot ? viewTopUm : gridExtentUm.maxY;
    const gxMinPx = gxMin * SCALE_FACTOR;
    const gxMaxPx = gxMax * SCALE_FACTOR;
    const gyMinPx = gyMin * SCALE_FACTOR;
    const gyMaxPx = gyMax * SCALE_FACTOR;
    const isMajor = (coord: number) => Math.abs(coord - Math.round(coord / majorStep) * majorStep) <= Math.max(1e-9, minorStep * 1e-6);

    const startXIndex = Math.ceil((gxMin + 1e-9) / minorStep);
    const endXIndex = Math.floor((gxMax - 1e-9) / minorStep);
    if (endXIndex - startXIndex <= 400) {
      for (let idx = startXIndex; idx <= endXIndex; idx += 1) {
        if (idx === 0) continue;
        const x = snapToGrid(idx * minorStep, gridSize);
        const px = x * SCALE_FACTOR;
        lines.push({ key: `gx-${idx}`, points: [px, gyMinPx, px, gyMaxPx], major: isMajor(x) });
      }
    }
    const startYIndex = Math.ceil((gyMin + 1e-9) / minorStep);
    const endYIndex = Math.floor((gyMax - 1e-9) / minorStep);
    if (endYIndex - startYIndex <= 400) {
      for (let idx = startYIndex; idx <= endYIndex; idx += 1) {
        if (idx === 0) continue;
        const y = snapToGrid(idx * minorStep, gridSize);
        const py = y * SCALE_FACTOR;
        lines.push({ key: `gy-${idx}`, points: [gxMinPx, py, gxMaxPx, py], major: isMajor(y) });
      }
    }

    // When zoomed closely onto the defined gridSize, show crisp Virtuoso grid intersection dots inside the visible viewport.
    const dots: Array<{ key: string; x: number; y: number }> = [];
    if (showFineDots && hasViewport) {
      const minX = Math.max(gxMin, viewLeftUm);
      const maxX = Math.min(gxMax, viewRightUm);
      const minY = Math.max(gyMin, viewBottomUm);
      const maxY = Math.min(gyMax, viewTopUm);
      const ixStart = Math.ceil((minX - 1e-9) / minorStep);
      const ixEnd = Math.floor((maxX + 1e-9) / minorStep);
      const iyStart = Math.ceil((minY - 1e-9) / minorStep);
      const iyEnd = Math.floor((maxY + 1e-9) / minorStep);
      const countX = Math.max(0, ixEnd - ixStart + 1);
      const countY = Math.max(0, iyEnd - iyStart + 1);
      if (countX * countY <= 900) {
        for (let ix = ixStart; ix <= ixEnd; ix += 1) {
          const px = snapToGrid(ix * minorStep, gridSize) * SCALE_FACTOR;
          for (let iy = iyStart; iy <= iyEnd; iy += 1) {
            const py = snapToGrid(iy * minorStep, gridSize) * SCALE_FACTOR;
            dots.push({ key: `gd-${ix}-${iy}`, x: px, y: py });
          }
        }
      }
    }

    return { lines, dots };
  }, [showGrid, stageScale, displayGrid, gridSize, gridExtentUm, baseIsRoot, stagePos.x, stagePos.y, dimensions.width, dimensions.height]);

  /** Recursively renders drawn LPP shapes and sub-instances inside an instantiated cellview. */
  const renderCellViewContents = (
    cellId: string,
    parentW: number,
    parentH: number,
    depth = 0,
    visited: Set<string> = new Set(),
  ): React.ReactNode => {
    if (depth > 3 || visited.has(cellId)) return null;
    const subView = cellId === activeCellId
      ? { shapes, instances, coordinateMode: activeCoordinateMode }
      : cellViews[cellId];
    if (!subView) return null;
    const subShapes = subView.shapes ?? [];
    const subInstances = subView.instances ?? [];
    if (subShapes.length === 0 && subInstances.length === 0) return null;
    const nextVisited = new Set(visited);
    nextVisited.add(cellId);
    const isCenteredLegacy = subView.coordinateMode === 'centered' || (subView.coordinateMode === undefined && subShapes.length === 0);
    const offsetX = isCenteredLegacy ? parentW / 2 : 0;
    const offsetY = isCenteredLegacy ? parentH / 2 : 0;

    return (
      <Group x={offsetX} y={offsetY} listening={false}>
        {subShapes.map(shape => {
          const style = resolveLayerStyle(shape.layer, shape.purpose, shape.color);
          const sw = shape.width * SCALE_FACTOR;
          const sh = shape.height * SCALE_FACTOR;
          const sx = shape.x * SCALE_FACTOR;
          const sy = shape.y * SCALE_FACTOR;
          return (
            <Group key={`sub-shape-${shape.id}`}>
              <Rect
                x={sx}
                y={sy}
                width={sw}
                height={sh}
                fill={style.color}
                opacity={style.fillOpacity}
                stroke={style.color}
                strokeWidth={1.1 / stageScale}
                dash={style.strokeDash === 'dashed' ? [6 / stageScale, 4 / stageScale] : undefined}
              />
              {shape.label?.trim() && sw * stageScale >= 28 && sh * stageScale >= 16 && (
                <Group x={sx} y={sy + sh} scaleY={-1}>
                  <Text
                    text={shape.label.trim()}
                    x={0}
                    y={(sh - Math.min(sw * 0.14, sh * 0.24)) / 2}
                    width={sw}
                    align="center"
                    fill={style.color}
                    fontSize={Math.min(sw * 0.14, sh * 0.24)}
                    fontFamily={CANVAS_FONT_MONO}
                    fontStyle="bold"
                    ellipsis={true}
                    wrap="none"
                  />
                </Group>
              )}
            </Group>
          );
        })}
        {subInstances.map(subInst => {
          const subMaster = masterCells[subInst.cellId];
          if (!subMaster) return null;
          const st = getTransformProps(subInst.orientation);
          const subOx = (subMaster.originX ?? 0) * SCALE_FACTOR;
          const subOy = (subMaster.originY ?? 0) * SCALE_FACTOR;
          const subW = subMaster.width * SCALE_FACTOR;
          const subH = subMaster.height * SCALE_FACTOR;
          const subViewContent = subInst.cellId === activeCellId
            ? { shapes, instances }
            : cellViews[subInst.cellId];
          const childHasContent = (subViewContent?.shapes?.length ?? 0) > 0 || (subViewContent?.instances?.length ?? 0) > 0;
          return (
            <Group
              key={subInst.id}
              x={subInst.x * SCALE_FACTOR}
              y={subInst.y * SCALE_FACTOR}
              rotation={st.rotation}
              scaleX={st.scaleX}
              scaleY={st.scaleY}
            >
              {!childHasContent && subW > 0 && subH > 0 && (
                <Rect
                  x={subOx}
                  y={subOy}
                  width={subW}
                  height={subH}
                  fill={subMaster.color}
                  opacity={Math.min(0.65, (subMaster.opacity ?? 0.5) * 0.8)}
                  stroke="rgba(15, 23, 42, 0.55)"
                  strokeWidth={0.8 / stageScale}
                />
              )}
              {renderCellViewContents(subInst.cellId, subW, subH, depth + 1, nextVisited)}
            </Group>
          );
        })}
      </Group>
    );
  };

  const canvasCursor = resolveCanvasCursor({
    appMode,
    edgeAlignmentActive: Boolean(edgeAlignmentSession),
    isPanning,
    isSpaceDown,
  });

  const selectionHasLocked = useMemo(
    () => selectedInstanceIds.some(id => instances.find(item => item.id === id)?.locked),
    [selectedInstanceIds, instances],
  );

  return (
    <div className="canvas-container" ref={containerRef}>
      <Stage
        width={dimensions.width}
        height={dimensions.height}
        onWheel={handleWheel}
        draggable={false}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        x={stagePos.x}
        y={stagePos.y}
        scaleX={stageScale}
        scaleY={-stageScale} 
        onDblClick={(e) => {
          if (appMode !== 'select' || partialSelectMode) return;
          let node = e.target as Konva.Node | null;
          while (node) {
            if (node.name() === 'pixel-array') {
              setPixelArraySelected(true);
              setRightSidebarPinned(true);
              return;
            }
            const id = node.id();
            if (id && instances.some(instance => instance.id === id)) {
              descendIntoInstance(id);
              return;
            }
            node = node.getParent();
          }
          if (e.target.name() === 'bg' || e.target === e.target.getStage()) {
            fitView();
          }
        }}
        onClick={(e) => {
          const pointer = stageRef.current?.getPointerPosition();
          const snapped = pointer ? getSnappedWorldPos(pointer, appMode === 'measure') : null;
          const editMapped = snapped
            ? (() => {
                if (!isEditInPlace) return { x: snapped.umX, y: snapped.umY };
                const mapped = baseToEditPoint(snapped.umX, snapped.umY);
                return { x: snapToGrid(mapped.x, gridSize), y: snapToGrid(mapped.y, gridSize) };
              })()
            : null;
          const editSnapAxis: SnapEdgeAxis | undefined = snapped?.snapEdgeAxis
            ? (isEditInPlace && ['R90', 'R270', 'MXR90', 'MYR90'].includes(eipInverseTransform.orientation)
                ? (snapped.snapEdgeAxis === 'vertical' ? 'horizontal' : 'vertical')
                : snapped.snapEdgeAxis)
            : undefined;
          
          if (appMode === 'measure' && snapped && editMapped) {
            if (!isMeasuring) {
              setIsMeasuring(true);
              setMeasureStart({ x: editMapped.x, y: editMapped.y, snapEdgeAxis: editSnapAxis });
              setCurrentRuler({ startX: editMapped.x, startY: editMapped.y, endX: editMapped.x, endY: editMapped.y });
            } else if (currentRuler) {
              setIsMeasuring(false);
              if (currentRuler.startX !== currentRuler.endX || currentRuler.startY !== currentRuler.endY) {
                addRuler(
                  currentRuler.startX,
                  currentRuler.startY,
                  currentRuler.endX,
                  currentRuler.endY,
                  currentRuler.referenceX,
                  currentRuler.referenceY,
                );
              }
              setCurrentRuler(null);
            }
          } else if (appMode === 'place' && placementMasterId && editMapped) {
            try {
              const placementMaster = masterCells[placementMasterId];
              if (pendingManualPadGroup) {
                placeManualPadGroup(editMapped.x, editMapped.y);
              } else {
                const targetPos = placementMaster && (isSubCellCanvas || placementMaster.kind !== 'pad')
                  ? clampWithSnapStep(
                      editMapped.x,
                      editMapped.y,
                      placementOrientation,
                      placementMaster.width,
                      placementMaster.height,
                      placementMaster.originX ?? 0,
                      placementMaster.originY ?? 0,
                    )
                  : { x: editMapped.x, y: editMapped.y };
                if (pendingInstanceArray && (pendingInstanceArray.rows > 1 || pendingInstanceArray.cols > 1)) {
                  placeInstanceMosaic(placementMasterId, targetPos.x, targetPos.y, placementOrientation, pendingInstanceArray);
                } else {
                  placeInstance(placementMasterId, targetPos.x, targetPos.y, placementOrientation, pendingInstanceArray?.namePrefix);
                }
              }
            } catch (error) {
              alert(error instanceof Error ? error.message : 'Unable to place the selected cell.');
            }
          } else if (appMode === 'pixel-array' && pendingPixelArraySize && editMapped) {
            placePixelArray(editMapped.x, editMapped.y);
          } else if (appMode === 'select' && !edgeAlignmentSession && (e.target === e.target.getStage() || e.target.name() === 'bg' || e.target.name() === 'overlay')) {
            if (performance.now() <= ignoreBackgroundClickUntilRef.current) {
              ignoreBackgroundClickUntilRef.current = 0;
              return;
            }
            if (!e.evt.shiftKey) {
              setSelectedInstance(null);
              setSelectedShape(null);
              if (hasPartialSelection(partialSelectionRef.current)) {
                updatePartialSelection({});
              }
            }
          }
        }}
        onContextMenu={(e) => {
          if (appMode === 'place' && placementMasterId) {
            e.evt.preventDefault();
            setPlacementOrientation(rotateOrientationByQuarterTurns(placementOrientation, e.evt.shiftKey ? 1 : -1));
          }
        }}
        ref={stageRef}
        style={{
          cursor: canvasCursor,
        }}
      >
        <Layer>
          {/* Infinite Background for panning (clean white drafting field for boundary-free Virtuoso IP cellviews) */}
          <Rect 
            name="bg"
            x={-bgExtent} 
            y={-bgExtent} 
            width={bgExtent * 2} 
            height={bgExtent * 2} 
            fill={!baseIsRoot ? '#ffffff' : 'transparent'} 
          />

          {/* Top-cell chip die boundary (anchored to Base View so Edit-in-Place stays inside the current cellview) */}
          {baseIsRoot && (
            <Rect 
              name="bg"
              x={boundaryX} 
              y={boundaryY} 
              width={tw} 
              height={th} 
              fill="#ffffff"
              stroke="#64748b" 
              strokeWidth={1.75 / stageScale}
              dash={[10 / stageScale, 8 / stageScale]}
              shadowColor="rgba(15, 23, 42, 0.1)"
              shadowBlur={24 / stageScale}
              shadowOffsetY={-4 / stageScale}
            />
          )}

          {/* Virtuoso Minor & Major Drafting Grid (exact integer multiples of gridSize in Base View space) */}
          {gridGeometry.lines.map(line => (
            <Line
              key={line.key}
              points={line.points}
              stroke={line.major ? '#cbd5e1' : '#e2e8f0'}
              strokeWidth={(line.major ? 1.1 : 0.75) / stageScale}
              listening={false}
            />
          ))}
          {gridGeometry.dots.map(dot => (
            <Circle
              key={dot.key}
              x={dot.x}
              y={dot.y}
              radius={1.4 / stageScale}
              fill="#94a3b8"
              listening={false}
            />
          ))}

          {/* Optional seal-ring / pad-inset inner perimeter guide */}
          {basePadInset > 0 && (
            <Rect
              x={boundaryX + basePadInset * SCALE_FACTOR}
              y={boundaryY + basePadInset * SCALE_FACTOR}
              width={tw - basePadInset * 2 * SCALE_FACTOR}
              height={th - basePadInset * 2 * SCALE_FACTOR}
              fillEnabled={false}
              stroke="#d97706"
              strokeWidth={1.25 / stageScale}
              dash={[6 / stageScale, 6 / stageScale]}
              opacity={0.65}
              listening={false}
            />
          )}

          {/* Grid Axes (span full die and beyond) + Virtuoso (0, 0) Origin Marker */}
          <Line points={[-axisExtent, 0, axisExtent, 0]} stroke={!baseIsRoot ? '#94a3b8' : '#cbd5e1'} strokeWidth={1 / stageScale} opacity={0.75} listening={false} />
          <Line points={[0, -axisExtent, 0, axisExtent]} stroke={!baseIsRoot ? '#94a3b8' : '#cbd5e1'} strokeWidth={1 / stageScale} opacity={0.75} listening={false} />
          <Group x={0} y={0} listening={false}>
            <Line points={[-9 / stageScale, 0, 9 / stageScale, 0]} stroke="#0284c7" strokeWidth={1.6 / stageScale} />
            <Line points={[0, -9 / stageScale, 0, 9 / stageScale]} stroke="#0284c7" strokeWidth={1.6 / stageScale} />
            <Circle radius={3 / stageScale} fill="#ffffff" stroke="#0284c7" strokeWidth={1.5 / stageScale} />
            <Text
              text="(0, 0)"
              x={6 / stageScale}
              y={-4 / stageScale}
              fill="#0284c7"
              fontSize={10.5 / stageScale}
              fontFamily={CANVAS_FONT_MONO}
              fontStyle="bold"
              scaleY={-1}
            />
          </Group>
          {baseIsRoot && (
            <>
              <Text
                text={`${baseCellName} (${formatGridValue(baseWidth, gridSize)}um x ${formatGridValue(baseHeight, gridSize)}um)`}
                x={boundaryX}
                y={boundaryY + th + 25 / stageScale}
                fill="#94a3b8"
                fontSize={15 / stageScale}
                fontFamily={CANVAS_FONT_SANS}
                scaleY={-1}
                listening={false}
              />
              {/* Top Right Coordinate */}
              <Text
                text={`(${formatGridValue(baseBoundaryBox.maxX, gridSize)}, ${formatGridValue(baseBoundaryBox.maxY, gridSize)})`}
                x={boundaryX + tw - 200 / stageScale}
                y={boundaryY + th + 25 / stageScale}
                width={200 / stageScale}
                align="right"
                fill="#94a3b8"
                fontSize={12 / stageScale}
                fontFamily={CANVAS_FONT_SANS}
                scaleY={-1}
                listening={false}
              />
              {/* Bottom Left Coordinate */}
              <Text
                text={`(${formatGridValue(baseBoundaryBox.minX, gridSize)}, ${formatGridValue(baseBoundaryBox.minY, gridSize)})`}
                x={boundaryX}
                y={boundaryY - 10 / stageScale}
                fill="#94a3b8"
                fontSize={12 / stageScale}
                fontFamily={CANVAS_FONT_SANS}
                scaleY={-1}
                listening={false}
              />
            </>
          )}

          {/* True Cadence Virtuoso Edit-in-Place (X): dimmed surrounding Base/parent context staying in exact place */}
          {isEditInPlace && showEditInPlaceContext && descendStack.map((frame, levelIdx) => {
            const parentId = frame.parentCellId;
            const isRootLevel = parentId === null;
            const parentView = parentId ? cellViews[parentId] : undefined;
            const parentMaster = parentId ? masterCells[parentId] : undefined;
            const parentInstances = isRootLevel
              ? (rootView?.instances ?? [])
              : (parentView?.instances ?? []);
            const parentShapes = isRootLevel
              ? (rootView?.shapes ?? [])
              : (parentView?.shapes ?? []);
            const parentPixelArray = isRootLevel
              ? (rootView?.pixelArray ?? null)
              : (parentView?.pixelArray ?? null);
            const parentW = isRootLevel ? (rootView?.topWidth ?? frame.parentWidth) : (parentMaster?.width ?? frame.parentWidth);
            const parentH = isRootLevel ? (rootView?.topHeight ?? frame.parentHeight) : (parentMaster?.height ?? frame.parentHeight);
            const parentCoordMode = isRootLevel
              ? 'origin'
              : (parentView?.coordinateMode ?? (parentInstances.length > 0 && parentShapes.length === 0 ? 'centered' : 'origin'));
            const levelForward = levelIdx === 0
              ? { x: 0, y: 0, orientation: 'R0' as const }
              : computeActiveToBaseTransform(liveEipChain.slice(0, levelIdx), parentCoordMode, parentW, parentH);
            const levelProps = getTransformProps(levelForward.orientation);
            const levelOpacity = levelIdx === descendStack.length - 1 ? 0.34 : 0.22;
            const siblingInstances = parentInstances.filter(inst => inst.id !== frame.instanceId);

            return (
              <Group
                key={`eip-context-${levelIdx}-${frame.instanceId}`}
                x={levelForward.x * SCALE_FACTOR}
                y={levelForward.y * SCALE_FACTOR}
                rotation={levelProps.rotation}
                scaleX={levelProps.scaleX}
                scaleY={levelProps.scaleY}
                opacity={levelOpacity}
                listening={false}
              >
                {parentPixelArray?.visible && (
                  <Rect
                    x={parentPixelArray.x * SCALE_FACTOR}
                    y={parentPixelArray.y * SCALE_FACTOR}
                    width={parentPixelArray.width * SCALE_FACTOR}
                    height={parentPixelArray.height * SCALE_FACTOR}
                    fill="rgba(139, 92, 246, 0.18)"
                    stroke="#7c3aed"
                    strokeWidth={1.5 / stageScale}
                    dash={[7 / stageScale, 5 / stageScale]}
                  />
                )}
                {parentShapes.map(shape => {
                  const style = resolveLayerStyle(shape.layer, shape.purpose, shape.color);
                  return (
                    <Rect
                      key={`eip-shape-${shape.id}`}
                      x={shape.x * SCALE_FACTOR}
                      y={shape.y * SCALE_FACTOR}
                      width={shape.width * SCALE_FACTOR}
                      height={shape.height * SCALE_FACTOR}
                      fill={style.color}
                      opacity={Math.max(0.25, style.fillOpacity)}
                      stroke={style.color}
                      strokeWidth={1.25 / stageScale}
                    />
                  );
                })}
                {siblingInstances.map(sib => {
                  const sibMaster = masterCells[sib.cellId];
                  if (!sibMaster || isCellEmpty(sibMaster)) return null;
                  const st = getTransformProps(sib.orientation);
                  const sibOx = (sibMaster.originX ?? 0) * SCALE_FACTOR;
                  const sibOy = (sibMaster.originY ?? 0) * SCALE_FACTOR;
                  const sibW = sibMaster.width * SCALE_FACTOR;
                  const sibH = sibMaster.height * SCALE_FACTOR;
                  const sibView = sib.cellId === activeCellId
                    ? { shapes, instances }
                    : cellViews[sib.cellId];
                  const sibHasContent = (sibView?.shapes?.length ?? 0) > 0 || (sibView?.instances?.length ?? 0) > 0;
                  const screenH = sibH * stageScale;
                  const screenW = sibW * stageScale;
                  const nameFS = Math.min(Math.min(sibW, sibH) * 0.18, Math.max(sibW, sibH) * 0.1);
                  const subFS = nameFS * 0.65;
                  const instFS = nameFS * 0.6;
                  const totalTextH = nameFS + subFS * 1.3 + instFS * 1.3;
                  const startY = (sibH - totalTextH) / 2;
                  return (
                    <Group
                      key={`eip-sib-${sib.id}`}
                      x={sib.x * SCALE_FACTOR}
                      y={sib.y * SCALE_FACTOR}
                      rotation={st.rotation}
                      scaleX={st.scaleX}
                      scaleY={st.scaleY}
                    >
                      {!sibHasContent && (
                        <>
                          <Rect
                            x={sibOx}
                            y={sibOy}
                            width={sibW}
                            height={sibH}
                            fill={sibMaster.color}
                            opacity={sibMaster.opacity ?? 0.5}
                            stroke="#334155"
                            strokeWidth={1 / stageScale}
                          />
                          {screenH >= 24 && screenW >= 30 && (
                            <Group x={sibOx} y={sibOy + sibH} scaleY={-1}>
                              {screenH > 48 && (
                                <Text
                                  text={sib.name}
                                  x={0}
                                  y={startY}
                                  width={sibW}
                                  align="center"
                                  fill="rgba(10, 20, 40, 0.55)"
                                  fontSize={instFS}
                                  fontFamily={CANVAS_FONT_SANS}
                                  ellipsis={true}
                                  wrap="none"
                                />
                              )}
                              <Text
                                text={sibMaster.cellName}
                                x={0}
                                y={startY + (screenH > 48 ? instFS * 1.3 : 0)}
                                width={sibW}
                                align="center"
                                fill="rgba(10, 20, 40, 0.9)"
                                fontSize={nameFS}
                                fontFamily={CANVAS_FONT_SANS}
                                fontStyle="bold"
                                ellipsis={true}
                                wrap="none"
                              />
                              {screenH > 36 && (
                                <Text
                                  text={`${formatGridValue(sibMaster.width, gridSize)} × ${formatGridValue(sibMaster.height, gridSize)} um`}
                                  x={0}
                                  y={startY + (screenH > 48 ? instFS * 1.3 : 0) + nameFS * 1.3}
                                  width={sibW}
                                  align="center"
                                  fill="rgba(10, 20, 40, 0.6)"
                                  fontSize={subFS}
                                  fontFamily={CANVAS_FONT_SANS}
                                  ellipsis={true}
                                  wrap="none"
                                />
                              )}
                            </Group>
                          )}
                        </>
                      )}
                      {sibHasContent && renderCellViewContents(sib.cellId, sibW, sibH)}
                    </Group>
                  );
                })}
              </Group>
            );
          })}
        </Layer>
        
        <Layer>
          {/* Active editable cellview geometry (transformed in-place via eipForwardTransform during Edit-in-Place X) */}
          <Group
            x={eipForwardTransform.x * SCALE_FACTOR}
            y={eipForwardTransform.y * SCALE_FACTOR}
            rotation={eipForwardProps.rotation}
            scaleX={eipForwardProps.scaleX}
            scaleY={eipForwardProps.scaleY}
          >
            {isEditInPlace && (
              <Group listening={false}>
                {activeMasterCell && !isCellEmpty(activeMasterCell) && (
                  <Rect
                    x={(activeMasterCell.originX ?? 0) * SCALE_FACTOR}
                    y={(activeMasterCell.originY ?? 0) * SCALE_FACTOR}
                    width={activeMasterCell.width * SCALE_FACTOR}
                    height={activeMasterCell.height * SCALE_FACTOR}
                    fillEnabled={false}
                    stroke="#6366f1"
                    strokeWidth={1.75 / stageScale}
                    dash={[6 / stageScale, 4 / stageScale]}
                    opacity={0.85}
                  />
                )}
                <Line points={[-7 / stageScale, 0, 7 / stageScale, 0]} stroke="#6366f1" strokeWidth={1.6 / stageScale} />
                <Line points={[0, -7 / stageScale, 0, 7 / stageScale]} stroke="#6366f1" strokeWidth={1.6 / stageScale} />
                <Circle radius={2.6 / stageScale} fill="#ffffff" stroke="#6366f1" strokeWidth={1.4 / stageScale} />
              </Group>
            )}

            {pixelArray?.visible && (
              <Group
                name="pixel-array"
                x={pixelArray.x * SCALE_FACTOR}
                y={pixelArray.y * SCALE_FACTOR}
                draggable={appMode === 'select' && !partialSelectMode && !edgeAlignmentSession}
                dragBoundFunc={pixelArrayDragBoundFunc}
                onClick={(event) => {
                  if (appMode === 'stretch' || partialSelectMode) return;
                  event.cancelBubble = true;
                  if (appMode === 'select' && !edgeAlignmentSession) setPixelArraySelected(true);
                }}
                onDragStart={() => setPixelArraySelected(true)}
                onDragEnd={(event) => {
                  try {
                    updatePixelArrayPosition(
                      event.target.x() / SCALE_FACTOR,
                      event.target.y() / SCALE_FACTOR,
                    );
                  } catch (error) {
                    alert(error instanceof Error ? error.message : 'Unable to move the pixel array.');
                  }
                }}
              >
                <Rect
                  name="overlay"
                  width={pixelArray.width * SCALE_FACTOR}
                  height={pixelArray.height * SCALE_FACTOR}
                  fill="rgba(139, 92, 246, 0.1)"
                  stroke={pixelArraySelected ? '#f59e0b' : '#8b5cf6'}
                  strokeWidth={(pixelArraySelected ? 3 : 2) / stageScale}
                  dash={[7 / stageScale, 5 / stageScale]}
                />
                {[1, 2, 3, 4, 5].map(index => (
                  <React.Fragment key={index}>
                    <Line
                      points={[pixelArray.width * SCALE_FACTOR * index / 6, 0, pixelArray.width * SCALE_FACTOR * index / 6, pixelArray.height * SCALE_FACTOR]}
                      stroke="#8b5cf6"
                      strokeWidth={0.6 / stageScale}
                      opacity={0.3}
                      listening={false}
                    />
                    <Line
                      points={[0, pixelArray.height * SCALE_FACTOR * index / 6, pixelArray.width * SCALE_FACTOR, pixelArray.height * SCALE_FACTOR * index / 6]}
                      stroke="#8b5cf6"
                      strokeWidth={0.6 / stageScale}
                      opacity={0.3}
                      listening={false}
                    />
                  </React.Fragment>
                ))}
                <Text
                  text={`PIXEL ARRAY\n${formatGridValue(pixelArray.width, gridSize)} × ${formatGridValue(pixelArray.height, gridSize)} um`}
                  width={pixelArray.width * SCALE_FACTOR}
                  y={pixelArray.height * SCALE_FACTOR / 2}
                  offsetY={14 / stageScale}
                  align="center"
                  fill="#6d28d9"
                  fontSize={11 / stageScale}
                  fontFamily={CANVAS_FONT_SANS}
                  fontStyle="bold"
                  lineHeight={1.35}
                  scaleY={-1}
                  listening={false}
                />
              </Group>
            )}

            {appMode === 'pixel-array' && pendingPixelArraySize && snappedMousePos && (() => {
              const editPos = isEditInPlace
                ? snapBaseToEditPoint(snappedMousePos.x, snappedMousePos.y).edit
                : snappedMousePos;
              try {
                const position = clampBoxInsideActiveBoundary(
                  editPos.x - pendingPixelArraySize.width / 2,
                  editPos.y - pendingPixelArraySize.height / 2,
                  pendingPixelArraySize.width,
                  pendingPixelArraySize.height,
                  gridSize,
                );
                return (
                  <Rect
                    x={position.x * SCALE_FACTOR}
                    y={position.y * SCALE_FACTOR}
                    width={pendingPixelArraySize.width * SCALE_FACTOR}
                    height={pendingPixelArraySize.height * SCALE_FACTOR}
                    fill="rgba(139, 92, 246, 0.13)"
                    stroke="#7c3aed"
                    strokeWidth={2 / stageScale}
                    dash={[7 / stageScale, 5 / stageScale]}
                    listening={false}
                  />
                );
              } catch {
                return null;
              }
            })()}

            {sortedInstances.map(inst => {
            const masterCell = masterCells[inst.cellId];
            if (!masterCell) return null;
            const ox = (masterCell.originX ?? 0) * SCALE_FACTOR;
            const oy = (masterCell.originY ?? 0) * SCALE_FACTOR;
            const w = masterCell.width * SCALE_FACTOR;
            const h = masterCell.height * SCALE_FACTOR;
            const isSelected = selectedInstanceIds.includes(inst.id);
            const isPrimarySelection = selectedInstanceId === inst.id;
            const childView = cellViews[inst.cellId];
            const childShapes = childView?.shapes ?? [];
            const childSubInstances = childView?.instances ?? [];
            const childHasContent = childShapes.length > 0 || childSubInstances.length > 0;
            const childIsEmpty = isCellEmpty(masterCell);

            const t = getTransformProps(inst.orientation);
            const outlineStyle = masterCell.outlineStyle ?? 'solid';
            const outlineDash = outlineStyle === 'dashed'
              ? [8 / stageScale, 6 / stageScale]
              : outlineStyle === 'dotted' ? [1.5 / stageScale, 4 / stageScale] : undefined;

            const groupDragOffset = multiDragDelta && inst.id !== multiDragDelta.anchorId && selectedInstanceIds.includes(inst.id)
              ? multiDragDelta
              : null;
            const renderX = (inst.x + (groupDragOffset?.dx ?? 0)) * SCALE_FACTOR;
            const renderY = (inst.y + (groupDragOffset?.dy ?? 0)) * SCALE_FACTOR;

            const canDragInstance = appMode === 'select'
              && !edgeAlignmentSession
              && !inst.locked
              && !(selectedInstanceIds.length > 1 && selectedInstanceIds.includes(inst.id) && selectionHasLocked);

            return (
              <Group
                key={inst.id}
                id={inst.id}
                x={renderX}
                y={renderY}
                rotation={t.rotation}
                scaleX={t.scaleX}
                scaleY={t.scaleY}
                draggable={canDragInstance && !partialSelectMode}
                dragBoundFunc={(pos) => dragBoundFunc(pos, inst.cellId, inst.orientation, inst.id)}
                onDragStart={() => handleDragStart(inst)}
                onDragMove={(e) => handleDragMove(e, inst.id)}
                onDragEnd={(e) => handleDragEnd(e, inst.id)}
                onClick={(e) => {
                  if (appMode === 'rect' || appMode === 'stretch' || partialSelectMode) return;
                  e.cancelBubble = true;
                  if (appMode === 'select' && !edgeAlignmentSession) {
                    setSelectedInstance(inst.id, e.evt.shiftKey);
                  }
                }}
                onDblClick={(e) => {
                  if (appMode === 'stretch' || partialSelectMode) return;
                  e.cancelBubble = true;
                  if (appMode === 'select' && !edgeAlignmentSession) {
                    descendIntoInstance(inst.id);
                  }
                }}
                onContextMenu={(e) => {
                  e.evt.preventDefault();
                  e.cancelBubble = true;
                  if (appMode !== 'select' || edgeAlignmentSession) return;
                  setSelectedInstance(inst.id);
                  try {
                    useStore.getState().updateInstanceOrientation(
                      inst.id,
                      rotateOrientationByQuarterTurns(inst.orientation, e.evt.shiftKey ? 1 : -1),
                    );
                  } catch (error) {
                    alert(error instanceof Error ? error.message : 'Unable to rotate the selected block.');
                  }
                }}
              >
                {childIsEmpty ? (
                  <Group x={0} y={0}>
                    <Circle radius={10 / stageScale} fill="transparent" />
                    <Line points={[-7 / stageScale, 0, 7 / stageScale, 0]} stroke={isSelected ? '#f59e0b' : '#64748b'} strokeWidth={1.6 / stageScale} />
                    <Line points={[0, -7 / stageScale, 0, 7 / stageScale]} stroke={isSelected ? '#f59e0b' : '#64748b'} strokeWidth={1.6 / stageScale} />
                    <Circle radius={3 / stageScale} fill="#ffffff" stroke={isSelected ? '#f59e0b' : '#64748b'} strokeWidth={1.4 / stageScale} />
                    <Text
                      text={`${inst.name} · ${masterCell.cellName} (empty)`}
                      x={8 / stageScale}
                      y={6 / stageScale}
                      fill="#64748b"
                      fontSize={10 / stageScale}
                      fontFamily={CANVAS_FONT_MONO}
                      scaleY={-1}
                      listening={false}
                    />
                  </Group>
                ) : childHasContent ? (
                  <>
                    {/* Transparent hit region so clicking/dragging works across the cell's full bounding box without drawing an artificial wrapper box */}
                    <Rect
                      x={ox}
                      y={oy}
                      width={w}
                      height={h}
                      fill="transparent"
                    />
                    {/* Live recursive sub-hierarchy & drawn LPP shapes (pure Virtuoso content, no artificial boundary box) */}
                    {renderCellViewContents(inst.cellId, w, h)}
                  </>
                ) : (
                  <>
                    <Rect
                      x={ox}
                      y={oy}
                      width={w}
                      height={h}
                      fill={masterCell.color}
                      opacity={masterCell.opacity ?? 0.5}
                    />
                    {outlineStyle !== 'none' && (
                      <Rect
                        x={ox}
                        y={oy}
                        width={w}
                        height={h}
                        fillEnabled={false}
                        stroke="#334155"
                        strokeWidth={1 / stageScale}
                        dash={outlineDash}
                        listening={false}
                      />
                    )}
                  </>
                )}
                {isSelected && !childIsEmpty && (
                  <>
                    <Rect
                      x={ox}
                      y={oy}
                      width={w}
                      height={h}
                      fillEnabled={false}
                      stroke={isPrimarySelection ? '#f59e0b' : '#38bdf8'}
                      strokeWidth={3 / stageScale}
                      listening={false}
                    />
                    {/* Instance (0, 0) origin marker */}
                    <Group x={0} y={0} listening={false}>
                      <Line points={[-6 / stageScale, 0, 6 / stageScale, 0]} stroke="#f59e0b" strokeWidth={1.6 / stageScale} />
                      <Line points={[0, -6 / stageScale, 0, 6 / stageScale]} stroke="#f59e0b" strokeWidth={1.6 / stageScale} />
                      <Circle radius={2.4 / stageScale} fill="#f59e0b" stroke="#ffffff" strokeWidth={0.9 / stageScale} />
                    </Group>
                  </>
                )}
                {inst.locked && !childIsEmpty && (
                  <Rect
                    x={ox}
                    y={oy}
                    width={w}
                    height={h}
                    fillEnabled={false}
                    stroke="#eab308"
                    strokeWidth={2 / stageScale}
                    dash={[5 / stageScale, 4 / stageScale]}
                    listening={false}
                  />
                )}
                
                {!childIsEmpty && !childHasContent && (() => {
                  const shortSide = Math.min(w, h);
                  const longSide = Math.max(w, h);
                  const fontSizeWorld = Math.min(shortSide * 0.18, longSide * 0.1);
                  const screenH = h * stageScale;
                  const screenW = w * stageScale;
                  if (screenH < 24 || screenW < 30) return null;

                  const nameFS = fontSizeWorld;
                  const subFS = fontSizeWorld * 0.65;
                  const instFS = fontSizeWorld * 0.6;
                  const totalTextH = nameFS + subFS * 1.3 + instFS * 1.3;
                  const startY = (h - totalTextH) / 2;

                  return (
                    <Group x={ox} y={oy + h} scaleY={-1} listening={false}>
                      {/* Instance name (top, smaller, secondary) */}
                      {screenH > 48 && (
                        <Text
                          text={inst.name}
                          x={0}
                          y={startY}
                          width={w}
                          align="center"
                          fill="rgba(10, 20, 40, 0.55)"
                          fontSize={instFS}
                          fontFamily={CANVAS_FONT_SANS}
                          fontStyle="normal"
                          ellipsis={true}
                          wrap="none"
                        />
                      )}
                      {/* Cell name (main label, bold) */}
                      <Text
                        text={masterCell.cellName}
                        x={0}
                        y={startY + (screenH > 48 ? instFS * 1.3 : 0)}
                        width={w}
                        align="center"
                        fill="rgba(10, 20, 40, 0.9)"
                        fontSize={nameFS}
                        fontFamily={CANVAS_FONT_SANS}
                        fontStyle="bold"
                        ellipsis={true}
                        wrap="none"
                      />
                      {/* Size (sub-label) */}
                      {screenH > 36 && (
                        <Text
                          text={`${formatGridValue(masterCell.width, gridSize)} × ${formatGridValue(masterCell.height, gridSize)} um`}
                          x={0}
                          y={startY + (screenH > 48 ? instFS * 1.3 : 0) + nameFS * 1.3}
                          width={w}
                          align="center"
                          fill="rgba(10, 20, 40, 0.6)"
                          fontSize={subFS}
                          fontFamily={CANVAS_FONT_SANS}
                          fontStyle="normal"
                          ellipsis={true}
                          wrap="none"
                        />
                      )}
                    </Group>
                  );
                })()}
              </Group>
            );
          })}

          {/* Drawn Layout Shapes (Virtuoso Rectangles on LPPs like text/drawing, prBoundary/drawing, M1/drawing) */}
          {shapes.map((shape: LayoutShape) => {
            const preview = shapeResizePreview && shapeResizePreview.id === shape.id ? shapeResizePreview : null;
            const curX = preview ? preview.x : shape.x;
            const curY = preview ? preview.y : shape.y;
            const curW = preview ? preview.width : shape.width;
            const curH = preview ? preview.height : shape.height;
            const sx = curX * SCALE_FACTOR;
            const sy = curY * SCALE_FACTOR;
            const sw = curW * SCALE_FACTOR;
            const sh = curH * SCALE_FACTOR;
            const isSelected = selectedShapeId === shape.id;
            const style = resolveLayerStyle(shape.layer, shape.purpose, shape.color);
            const canDragShape = appMode === 'select' && !partialSelectMode && !edgeAlignmentSession && !shape.locked;
            const tagText = shape.label?.trim()
              ? `${shape.label.trim()}\n${shape.layer}/${shape.purpose}`
              : `${shape.layer}/${shape.purpose}`;
            const handleSize = 7 / stageScale;

            const buildResizeCorners = () => {
              if (!isSelected || !canDragShape) return null;
              // Anchor opposite corners to the original immutable `shape` bounds so dragging past an edge never flips the anchor.
              const corners: Array<{ key: 'sw' | 'se' | 'ne' | 'nw'; hx: number; hy: number; anchorX: number; anchorY: number }> = [
                { key: 'sw', hx: curX, hy: curY, anchorX: shape.x + shape.width, anchorY: shape.y + shape.height },
                { key: 'se', hx: curX + curW, hy: curY, anchorX: shape.x, anchorY: shape.y + shape.height },
                { key: 'ne', hx: curX + curW, hy: curY + curH, anchorX: shape.x, anchorY: shape.y },
                { key: 'nw', hx: curX, hy: curY + curH, anchorX: shape.x + shape.width, anchorY: shape.y },
              ];
              return corners.map(corner => (
                <Rect
                  key={`shape-handle-${shape.id}-${corner.key}`}
                  x={corner.hx * SCALE_FACTOR}
                  y={corner.hy * SCALE_FACTOR}
                  offsetX={handleSize / 2}
                  offsetY={handleSize / 2}
                  width={handleSize}
                  height={handleSize}
                  fill="#ffffff"
                  stroke="#f59e0b"
                  strokeWidth={1.6 / stageScale}
                  draggable
                  dragBoundFunc={snapScreenDragPosForEdit}
                  onClick={event => { event.cancelBubble = true; }}
                  onDragMove={event => {
                    const nx = event.target.x() / SCALE_FACTOR;
                    const ny = event.target.y() / SCALE_FACTOR;
                    const nextRect = normalizeRectFromPoints(corner.anchorX, corner.anchorY, nx, ny, activeSnapStep, gridSize);
                    if (nextRect) {
                      setShapeResizePreview({ id: shape.id, ...nextRect });
                    }
                  }}
                  onDragEnd={event => {
                    const nx = event.target.x() / SCALE_FACTOR;
                    const ny = event.target.y() / SCALE_FACTOR;
                    const nextRect = normalizeRectFromPoints(corner.anchorX, corner.anchorY, nx, ny, activeSnapStep, gridSize);
                    setShapeResizePreview(null);
                    if (nextRect) {
                      try {
                        updateShape(shape.id, nextRect);
                      } catch (error) {
                        alert(error instanceof Error ? error.message : 'Unable to resize rectangle.');
                      }
                    }
                  }}
                />
              ));
            };

            return (
              <React.Fragment key={shape.id}>
                <Group
                  x={sx}
                  y={sy}
                  draggable={canDragShape}
                  dragBoundFunc={snapScreenDragPosForEdit}
                  onClick={event => {
                    if (appMode === 'rect' || appMode === 'stretch' || partialSelectMode) return;
                    event.cancelBubble = true;
                    if (appMode === 'select' && !edgeAlignmentSession) {
                      setSelectedShape(shape.id);
                    }
                  }}
                  onDblClick={event => {
                    if (appMode !== 'select' || partialSelectMode) return;
                    event.cancelBubble = true;
                    setSelectedShape(shape.id);
                    setRightSidebarPinned(true);
                  }}
                  onDragEnd={event => {
                    const nextX = snapToGrid(event.target.x() / SCALE_FACTOR, gridSize);
                    const nextY = snapToGrid(event.target.y() / SCALE_FACTOR, gridSize);
                    try {
                      updateShape(shape.id, { x: nextX, y: nextY });
                    } catch (error) {
                      event.target.x(shape.x * SCALE_FACTOR);
                      event.target.y(shape.y * SCALE_FACTOR);
                      alert(error instanceof Error ? error.message : 'Unable to move rectangle.');
                    }
                  }}
                >
                  <Rect
                    width={sw}
                    height={sh}
                    fill={style.color}
                    opacity={style.fillOpacity}
                    stroke={isSelected ? '#f59e0b' : style.color}
                    strokeWidth={(isSelected ? 2.5 : 1.5) / stageScale}
                    dash={style.strokeDash === 'dashed' ? [7 / stageScale, 5 / stageScale] : undefined}
                  />
                  {shape.locked && (
                    <Rect
                      width={sw}
                      height={sh}
                      fillEnabled={false}
                      stroke="#eab308"
                      strokeWidth={1.8 / stageScale}
                      dash={[4 / stageScale, 4 / stageScale]}
                      listening={false}
                    />
                  )}
                  {!isEditInPlace && sw * stageScale >= 34 && sh * stageScale >= 20 && (
                    <Group x={0} y={sh} scaleY={-1} listening={false}>
                      <Text
                        text={tagText}
                        x={4 / stageScale}
                        y={Math.max(2 / stageScale, (sh - Math.min(13 / stageScale, sh * 0.28) * (shape.label?.trim() ? 2.3 : 1.2)) / 2)}
                        width={Math.max(1, sw - 8 / stageScale)}
                        align="center"
                        fill={isSelected ? '#92400e' : style.color}
                        fontSize={Math.min(12 / stageScale, Math.max(8 / stageScale, Math.min(sw * 0.14, sh * 0.24)))}
                        fontFamily={CANVAS_FONT_MONO}
                        fontStyle="bold"
                        lineHeight={1.25}
                        ellipsis={true}
                      />
                    </Group>
                  )}
                </Group>
                {buildResizeCorners()}
              </React.Fragment>
            );
          })}

          {/* Live Rubber-Band Rectangle Draft Preview (Create Rect mode) */}
          {appMode === 'rect' && rectDraft && (() => {
            const draftRect = normalizeRectFromPoints(rectDraft.startX, rectDraft.startY, rectDraft.currentX, rectDraft.currentY, activeSnapStep, gridSize);
            const activeStyle = resolveLayerStyle(activeDrawLayer, activeDrawPurpose, activeDrawColor);
            if (!draftRect) {
              return (
                <Circle
                  x={rectDraft.startX * SCALE_FACTOR}
                  y={rectDraft.startY * SCALE_FACTOR}
                  radius={4 / stageScale}
                  fill={activeStyle.color}
                  stroke="#ffffff"
                  strokeWidth={1.2 / stageScale}
                  listening={false}
                />
              );
            }
            const dx = draftRect.x * SCALE_FACTOR;
            const dy = draftRect.y * SCALE_FACTOR;
            const dw = draftRect.width * SCALE_FACTOR;
            const dh = draftRect.height * SCALE_FACTOR;
            return (
              <Rect
                x={dx}
                y={dy}
                width={dw}
                height={dh}
                fill={activeStyle.color}
                opacity={Math.max(0.2, activeStyle.fillOpacity)}
                stroke={activeStyle.color}
                strokeWidth={2 / stageScale}
                dash={[6 / stageScale, 4 / stageScale]}
                listening={false}
              />
            );
          })()}

          {/* Virtuoso Partial Select (F4) & Stretch (S) edge highlights, live stretch preview, and partial marquee */}
          {(() => {
            const getEdgePts = (s: LayoutShape, edge: RectEdge): number[] => {
              const x1 = s.x * SCALE_FACTOR;
              const y1 = s.y * SCALE_FACTOR;
              const x2 = (s.x + s.width) * SCALE_FACTOR;
              const y2 = (s.y + s.height) * SCALE_FACTOR;
              if (edge === 'left') return [x1, y1, x1, y2];
              if (edge === 'right') return [x2, y1, x2, y2];
              if (edge === 'bottom') return [x1, y1, x2, y1];
              return [x1, y2, x2, y2];
            };
            const shapeById = new Map(shapes.map(s => [s.id, s]));
            const nodes: React.ReactNode[] = [];

            // 1. Hovered stretchable edge/corner preview
            if (hoveredStretchHit && !stretchSession) {
              const s = shapeById.get(hoveredStretchHit.shapeId);
              if (s) {
                hoveredStretchHit.edges.forEach(edge => {
                  nodes.push(
                    <Line
                      key={`stretch-hover-${s.id}-${edge}`}
                      points={getEdgePts(s, edge)}
                      stroke="#06b6d4"
                      strokeWidth={3 / stageScale}
                      lineCap="round"
                      opacity={0.9}
                      listening={false}
                    />,
                  );
                });
              }
            }

            // 2. Partially selected edges & vertices (bright Virtuoso highlight magenta)
            Object.entries(partialSelection).forEach(([shapeId, edges]) => {
              const s = shapeById.get(shapeId);
              if (!s || edges.length === 0) return;
              edges.forEach(edge => {
                const pts = getEdgePts(s, edge);
                nodes.push(
                  <React.Fragment key={`partial-edge-${shapeId}-${edge}`}>
                    <Line
                      points={pts}
                      stroke="#ec4899"
                      strokeWidth={3.5 / stageScale}
                      lineCap="round"
                      listening={false}
                    />
                    <Circle x={pts[0]} y={pts[1]} radius={3.2 / stageScale} fill="#ffffff" stroke="#ec4899" strokeWidth={1.6 / stageScale} listening={false} />
                    <Circle x={pts[2]} y={pts[3]} radius={3.2 / stageScale} fill="#ffffff" stroke="#ec4899" strokeWidth={1.6 / stageScale} listening={false} />
                  </React.Fragment>,
                );
              });
            });

            // 3. Live Stretch rubber-band preview & delta vector
            if (stretchSession) {
              const dx = stretchSession.currentX - stretchSession.anchorX;
              const dy = stretchSession.currentY - stretchSession.anchorY;
              const previewUpdates = computeStretchedShapes(shapes, stretchSession.selection, dx, dy, activeSnapStep, gridSize);
              previewUpdates.forEach(u => {
                nodes.push(
                  <Rect
                    key={`stretch-ghost-${u.id}`}
                    x={u.x * SCALE_FACTOR}
                    y={u.y * SCALE_FACTOR}
                    width={u.width * SCALE_FACTOR}
                    height={u.height * SCALE_FACTOR}
                    fill="rgba(236, 72, 153, 0.16)"
                    stroke="#ec4899"
                    strokeWidth={2 / stageScale}
                    dash={[6 / stageScale, 4 / stageScale]}
                    listening={false}
                  />,
                );
              });
              const ax = stretchSession.anchorX * SCALE_FACTOR;
              const ay = stretchSession.anchorY * SCALE_FACTOR;
              const cx = stretchSession.currentX * SCALE_FACTOR;
              const cy = stretchSession.currentY * SCALE_FACTOR;
              nodes.push(
                <Group key="stretch-vector" listening={false}>
                  <Line points={[ax, ay, cx, cy]} stroke="#ec4899" strokeWidth={1.6 / stageScale} dash={[4 / stageScale, 3 / stageScale]} />
                  <Circle x={ax} y={ay} radius={3.2 / stageScale} fill="#ec4899" />
                  <Circle x={cx} y={cy} radius={3.5 / stageScale} fill="#ffffff" stroke="#ec4899" strokeWidth={1.8 / stageScale} />
                </Group>,
              );
            }

            // 4. Partial Select marquee box (distinct magenta dashed frame)
            if (partialMarquee) {
              const mx = Math.min(partialMarquee.startX, partialMarquee.currentX) * SCALE_FACTOR;
              const my = Math.min(partialMarquee.startY, partialMarquee.currentY) * SCALE_FACTOR;
              const mw = Math.abs(partialMarquee.currentX - partialMarquee.startX) * SCALE_FACTOR;
              const mh = Math.abs(partialMarquee.currentY - partialMarquee.startY) * SCALE_FACTOR;
              nodes.push(
                <Rect
                  key="partial-marquee"
                  x={mx}
                  y={my}
                  width={mw}
                  height={mh}
                  fill="rgba(236, 72, 153, 0.10)"
                  stroke="#ec4899"
                  strokeWidth={1.4 / stageScale}
                  dash={[5 / stageScale, 4 / stageScale]}
                  listening={false}
                />,
              );
            }

            return nodes;
          })()}

          {/* Overlap / DRC Violation Highlights */}
          {showOverlapDrc && overlapViolations.map(violation => {
            const vx = violation.minX * SCALE_FACTOR;
            const vy = violation.minY * SCALE_FACTOR;
            const vw = violation.width * SCALE_FACTOR;
            const vh = violation.height * SCALE_FACTOR;
            return (
              <Group key={`drc-overlap-${violation.id}`} listening={false}>
                <Rect
                  x={vx}
                  y={vy}
                  width={vw}
                  height={vh}
                  fill="rgba(239, 68, 68, 0.28)"
                  stroke="#ef4444"
                  strokeWidth={2 / stageScale}
                  dash={[5 / stageScale, 3 / stageScale]}
                />
                <Line
                  points={[vx, vy, vx + vw, vy + vh]}
                  stroke="#ef4444"
                  strokeWidth={1.25 / stageScale}
                  opacity={0.75}
                />
                <Line
                  points={[vx, vy + vh, vx + vw, vy]}
                  stroke="#ef4444"
                  strokeWidth={1.25 / stageScale}
                  opacity={0.75}
                />
              </Group>
            );
          })}

          {/* Cadence-style edge picker: source edge first, then a fixed target edge. */}
          {edgeAlignmentSession && (() => {
            const session = edgeAlignmentSession;
            const sourceAxis = session.sourceEdge ? getAlignmentEdgeAxis(session.sourceEdge) : null;
            const edgeLine = (box: BBox, edge: AlignmentEdge) => {
              if (edge === 'left') return [box.minX, box.minY, box.minX, box.maxY];
              if (edge === 'right') return [box.maxX, box.minY, box.maxX, box.maxY];
              if (edge === 'bottom') return [box.minX, box.minY, box.maxX, box.minY];
              return [box.minX, box.maxY, box.maxX, box.maxY];
            };

            const ipEdges = instances.flatMap(instance => {
              const box = computeInstanceBBox(instance);
              if (!box) return [];
              const isSource = session.sourceIds.includes(instance.id);
              const isPivot = instance.id === session.sourceId;
              if (!isSource && !sourceAxis) return [];
              const edges: AlignmentEdge[] = isSource
                ? (session.sourceEdge ? (isPivot ? [session.sourceEdge] : []) : ['left', 'right', 'bottom', 'top'])
                : sourceAxis === 'horizontal' ? ['left', 'right'] : ['bottom', 'top'];

              return edges.map(edge => {
                const key = `${instance.id}-${edge}`;
                const chosen = (isSource && session.sourceEdge === edge)
                  || (!isSource && session.targetId === instance.id && session.targetEdge === edge);
                const color = isSource ? '#f59e0b' : '#10b981';
                const points = edgeLine(box, edge).map(value => value * SCALE_FACTOR);
                return (
                  <Line
                    key={`align-edge-${key}`}
                    points={points}
                    stroke={color}
                    strokeWidth={(chosen || hoveredAlignEdge === key ? 5 : 3) / stageScale}
                    opacity={chosen || hoveredAlignEdge === key ? 1 : 0.78}
                    hitStrokeWidth={18 / stageScale}
                    lineCap="round"
                    onMouseEnter={() => setHoveredAlignEdge(key)}
                    onMouseLeave={() => setHoveredAlignEdge(null)}
                    onClick={(event) => {
                      event.cancelBubble = true;
                      if (isSource) {
                        setEdgeAlignmentEdge(instance.id, edge);
                      } else {
                        try {
                          completeEdgeAlignment(instance.id, edge);
                        } catch (error) {
                          alert(error instanceof Error ? error.message : 'Unable to align edges.');
                        }
                      }
                    }}
                  />
                );
              });
            });

            const pixelArrayEdges = pixelArray?.visible ? (() => {
              const isSource = session.sourceIds.includes(PIXEL_ARRAY_ALIGNMENT_ID);
              if (!isSource && !sourceAxis) return [];
              const box: BBox = {
                minX: pixelArray.x,
                maxX: pixelArray.x + pixelArray.width,
                minY: pixelArray.y,
                maxY: pixelArray.y + pixelArray.height,
              };
              const edges: AlignmentEdge[] = isSource
                ? (session.sourceEdge ? [session.sourceEdge] : ['left', 'right', 'bottom', 'top'])
                : sourceAxis === 'horizontal' ? ['left', 'right'] : ['bottom', 'top'];
              return edges.map(edge => {
                const key = `pixel-array-${edge}`;
                const chosen = (isSource && session.sourceEdge === edge)
                  || (!isSource && session.targetId === PIXEL_ARRAY_ALIGNMENT_ID && session.targetEdge === edge);
                return (
                  <Line
                    key={`align-edge-${key}`}
                    points={edgeLine(box, edge).map(value => value * SCALE_FACTOR)}
                    stroke={isSource ? '#f59e0b' : '#10b981'}
                    strokeWidth={(chosen || hoveredAlignEdge === key ? 5 : 3) / stageScale}
                    opacity={chosen || hoveredAlignEdge === key ? 1 : 0.78}
                    hitStrokeWidth={18 / stageScale}
                    lineCap="round"
                    onMouseEnter={() => setHoveredAlignEdge(key)}
                    onMouseLeave={() => setHoveredAlignEdge(null)}
                    onClick={event => {
                      event.cancelBubble = true;
                      if (isSource) {
                        setEdgeAlignmentEdge(PIXEL_ARRAY_ALIGNMENT_ID, edge);
                      } else {
                        try {
                          completeEdgeAlignment(PIXEL_ARRAY_ALIGNMENT_ID, edge);
                        } catch (error) {
                          alert(error instanceof Error ? error.message : 'Unable to align to the pixel array.');
                        }
                      }
                    }}
                  />
                );
              });
            })() : [];

            if (!sourceAxis || isSubCellCanvas) return [...ipEdges, ...pixelArrayEdges];
            const boundaryEdges: AlignmentEdge[] = sourceAxis === 'horizontal'
              ? ['left', 'right']
              : ['bottom', 'top'];
            const boundaryBox: BBox = activeBoundaryBox;
            const boundaryTargets = boundaryEdges.map(edge => {
              const key = `top-${edge}`;
              return (
                <Line
                  key={`align-edge-${key}`}
                  points={edgeLine(boundaryBox, edge).map(value => value * SCALE_FACTOR)}
                  stroke="#10b981"
                  strokeWidth={(hoveredAlignEdge === key ? 5 : 3) / stageScale}
                  opacity={hoveredAlignEdge === key ? 1 : 0.78}
                  hitStrokeWidth={18 / stageScale}
                  lineCap="round"
                  onMouseEnter={() => setHoveredAlignEdge(key)}
                  onMouseLeave={() => setHoveredAlignEdge(null)}
                  onClick={event => {
                    event.cancelBubble = true;
                    try {
                      completeEdgeAlignmentToBoundary(edge as 'left' | 'right' | 'bottom' | 'top');
                    } catch (error) {
                      alert(error instanceof Error ? error.message : 'Unable to align to the top cell.');
                    }
                  }}
                />
              );
            });
            return [...ipEdges, ...pixelArrayEdges, ...boundaryTargets];
          })()}

          {selectionBox && (
            <Rect
              x={Math.min(selectionBox.startX, selectionBox.currentX) * SCALE_FACTOR}
              y={Math.min(selectionBox.startY, selectionBox.currentY) * SCALE_FACTOR}
              width={Math.abs(selectionBox.currentX - selectionBox.startX) * SCALE_FACTOR}
              height={Math.abs(selectionBox.currentY - selectionBox.startY) * SCALE_FACTOR}
              fill="rgba(56, 189, 248, 0.2)"
              stroke="#38bdf8"
              strokeWidth={1 / stageScale}
              dash={[4 / stageScale, 4 / stageScale]}
              listening={false}
            />
          )}

          {/* Orthogonal rulers can serve as X/Y references during edge alignment. */}
          {edgeAlignmentSession?.sourceEdge && (() => {
            const axis = getAlignmentEdgeAxis(edgeAlignmentSession.sourceEdge);
            return rulers.flatMap(ruler => {
              const vertical = Math.abs(ruler.endX - ruler.startX) <= 1e-9;
              const horizontal = Math.abs(ruler.endY - ruler.startY) <= 1e-9;
              if ((axis === 'horizontal' && !vertical) || (axis === 'vertical' && !horizontal)) return [];
              const key = `ruler-${ruler.id}`;
              return [(
                <Line
                  key={`align-${key}`}
                  points={[
                    ruler.startX * SCALE_FACTOR,
                    ruler.startY * SCALE_FACTOR,
                    ruler.endX * SCALE_FACTOR,
                    ruler.endY * SCALE_FACTOR,
                  ]}
                  stroke="#10b981"
                  strokeWidth={(hoveredAlignEdge === key ? 5 : 3) / stageScale}
                  opacity={hoveredAlignEdge === key ? 1 : 0.82}
                  hitStrokeWidth={18 / stageScale}
                  lineCap="round"
                  onMouseEnter={() => setHoveredAlignEdge(key)}
                  onMouseLeave={() => setHoveredAlignEdge(null)}
                  onClick={event => {
                    event.cancelBubble = true;
                    try {
                      completeEdgeAlignmentToRuler(ruler.id);
                    } catch (error) {
                      alert(error instanceof Error ? error.message : 'Unable to align to the ruler.');
                    }
                  }}
                />
              )];
            });
          })()}

          {/* Ghost Placement Group */}
          {appMode === 'place' && placementMasterId && masterCells[placementMasterId] && snappedMousePos && (() => {
            const m = masterCells[placementMasterId];
            const ghostHasContent = (cellViews[m.id]?.shapes?.length ?? 0) > 0 || (cellViews[m.id]?.instances?.length ?? 0) > 0;
            const ghostOx = (m.originX ?? 0) * SCALE_FACTOR;
            const ghostOy = (m.originY ?? 0) * SCALE_FACTOR;
            const editCursorPos = isEditInPlace
              ? snapBaseToEditPoint(snappedMousePos.x, snappedMousePos.y).edit
              : snappedMousePos;
            let previewOrientation = placementOrientation;
            let ghostPosition = editCursorPos;
            if (m.kind === 'pad' && !isSubCellCanvas) {
              try {
                if (pendingManualPadGroup) {
                  const snapped = snapPadToAutoOrientedEdge(editCursorPos.x, editCursorPos.y, m.width, m.height, topWidth, topHeight, gridSize, padInset, m.originX ?? 0, m.originY ?? 0);
                  previewOrientation = snapped.orientation;
                  const t = getTransformProps(previewOrientation);
                  const horizontal = snapped.side === 'top' || snapped.side === 'bottom';
                  const centerAlong = horizontal ? editCursorPos.x : editCursorPos.y;
                  const positions = computePadGroupPositions({
                    width: m.width, height: m.height, originX: m.originX, originY: m.originY, count: pendingManualPadGroup.count,
                    pitch: pendingManualPadGroup.pitch, side: snapped.side, centerAlong,
                    orientation: previewOrientation, topWidth, topHeight, gridSize, padInset,
                  });
                  return <>{positions.map((position, index) => (
                    <Group
                      key={`manual-pad-ghost-${index}`}
                      x={position.x * SCALE_FACTOR}
                      y={position.y * SCALE_FACTOR}
                      rotation={t.rotation}
                      scaleX={t.scaleX}
                      scaleY={t.scaleY}
                      opacity={0.55}
                      listening={false}
                    >
                      {!ghostHasContent && (
                        <Rect
                          x={ghostOx}
                          y={ghostOy}
                          width={m.width * SCALE_FACTOR}
                          height={m.height * SCALE_FACTOR}
                          fill={m.color}
                          stroke="#f8fafc"
                          strokeWidth={2 / stageScale}
                          dash={[5 / stageScale, 5 / stageScale]}
                        />
                      )}
                      {renderCellViewContents(m.id, m.width * SCALE_FACTOR, m.height * SCALE_FACTOR)}
                    </Group>
                  ))}</>;
                }
                ghostPosition = snapPadToNearestEdge(editCursorPos.x, editCursorPos.y, m.width, m.height, topWidth, topHeight, gridSize, placementOrientation, padInset, m.originX ?? 0, m.originY ?? 0);
              } catch {
                return null;
              }
            } else {
              try {
                ghostPosition = clampWithSnapStep(
                  editCursorPos.x,
                  editCursorPos.y,
                  placementOrientation,
                  m.width,
                  m.height,
                  m.originX ?? 0,
                  m.originY ?? 0,
                );
              } catch {
                return null;
              }
            }
            const t = getTransformProps(previewOrientation);
            if (pendingInstanceArray && (pendingInstanceArray.rows > 1 || pendingInstanceArray.cols > 1)) {
              const rows = Math.max(1, Math.min(50, Math.floor(pendingInstanceArray.rows)));
              const cols = Math.max(1, Math.min(50, Math.floor(pendingInstanceArray.cols)));
              const ghosts: Array<{ key: string; x: number; y: number }> = [];
              for (let r = 0; r < rows; r += 1) {
                for (let c = 0; c < cols; c += 1) {
                  try {
                    const p = isSubCellCanvas
                      ? snapPointToGrid(
                          ghostPosition.x + c * pendingInstanceArray.deltaX,
                          ghostPosition.y + r * pendingInstanceArray.deltaY,
                          gridSize,
                        )
                      : clampInstancePosition(
                          ghostPosition.x + c * pendingInstanceArray.deltaX,
                          ghostPosition.y + r * pendingInstanceArray.deltaY,
                          previewOrientation,
                          m.width,
                          m.height,
                          topWidth,
                          topHeight,
                          gridSize,
                          m.originX ?? 0,
                          m.originY ?? 0,
                        );
                    ghosts.push({ key: `mosaic-${r}-${c}`, x: p.x, y: p.y });
                  } catch {
                    // skip out-of-bounds ghost cell
                  }
                }
              }
              return (
                <>
                  {ghosts.map(pos => (
                    <Group
                      key={pos.key}
                      x={pos.x * SCALE_FACTOR}
                      y={pos.y * SCALE_FACTOR}
                      rotation={t.rotation}
                      scaleX={t.scaleX}
                      scaleY={t.scaleY}
                      opacity={0.55}
                      listening={false}
                    >
                      {!ghostHasContent && (
                        <Rect
                          x={ghostOx}
                          y={ghostOy}
                          width={m.width * SCALE_FACTOR}
                          height={m.height * SCALE_FACTOR}
                          fill={m.color}
                          stroke="#f8fafc"
                          strokeWidth={2 / stageScale}
                          dash={[5 / stageScale, 5 / stageScale]}
                        />
                      )}
                      {renderCellViewContents(m.id, m.width * SCALE_FACTOR, m.height * SCALE_FACTOR)}
                    </Group>
                  ))}
                </>
              );
            }
            const ghostOverlap = findOverlappingInstance(
              { x: ghostPosition.x, y: ghostPosition.y, orientation: previewOrientation, width: m.width, height: m.height, originX: m.originX, originY: m.originY },
              instances,
              masterCells,
            );
            return (
              <Group
                x={ghostPosition.x * SCALE_FACTOR}
                y={ghostPosition.y * SCALE_FACTOR}
                rotation={t.rotation}
                scaleX={t.scaleX}
                scaleY={t.scaleY}
                opacity={ghostOverlap ? 0.72 : 0.65}
                listening={false}
              >
                {(!ghostHasContent || ghostOverlap) && (
                  <Rect
                    x={ghostOx}
                    y={ghostOy}
                    width={m.width * SCALE_FACTOR}
                    height={m.height * SCALE_FACTOR}
                    fill={ghostOverlap ? '#ef4444' : m.color}
                    stroke={ghostOverlap ? '#dc2626' : '#f8fafc'}
                    strokeWidth={(ghostOverlap ? 2.5 : 2) / stageScale}
                    dash={[5 / stageScale, 5 / stageScale]}
                    opacity={ghostOverlap ? 0.55 : 0.5}
                  />
                )}
                {renderCellViewContents(m.id, m.width * SCALE_FACTOR, m.height * SCALE_FACTOR)}
                {!ghostHasContent && (() => {
                  const w = m.width * SCALE_FACTOR;
                  const h = m.height * SCALE_FACTOR;
                  const screenH = h * stageScale;
                  const screenW = w * stageScale;
                  if (screenH < 24 || screenW < 30) return null;
                  const shortSide = Math.min(w, h);
                  const longSide = Math.max(w, h);
                  const nameFS = Math.min(shortSide * 0.18, longSide * 0.1);
                  const subFS = nameFS * 0.65;
                  const totalTextH = nameFS + subFS * 1.3;
                  const startY = (h - totalTextH) / 2;
                  return (
                    <Group x={ghostOx} y={ghostOy + h} scaleY={-1}>
                      <Text
                        text={m.cellName}
                        x={0}
                        y={startY}
                        width={w}
                        align="center"
                        fill="rgba(10, 20, 40, 0.9)"
                        fontSize={nameFS}
                        fontFamily={CANVAS_FONT_SANS}
                        fontStyle="bold"
                        ellipsis={true}
                        wrap="none"
                      />
                      {screenH > 36 && (
                        <Text
                          text={`${formatGridValue(m.width, gridSize)} × ${formatGridValue(m.height, gridSize)} um`}
                          x={0}
                          y={startY + nameFS * 1.3}
                          width={w}
                          align="center"
                          fill="rgba(10, 20, 40, 0.6)"
                          fontSize={subFS}
                          fontFamily={CANVAS_FONT_SANS}
                          fontStyle="normal"
                          ellipsis={true}
                          wrap="none"
                        />
                      )}
                    </Group>
                  );
                })()}
              </Group>
            );
          })()}
          </Group>

          {/* Always-upright Base-space overlays (selection pills, EIP shape tags, draft/stretch readouts, rulers, gap dims, reticle) */}
          {selectedInstanceIds.map(selId => {
            const inst = instances.find(item => item.id === selId);
            if (!inst) return null;
            const masterCell = masterCells[inst.cellId];
            if (!masterCell || isCellEmpty(masterCell)) return null;
            const childView = cellViews[inst.cellId];
            const childHasContent = (childView?.shapes?.length ?? 0) > 0 || (childView?.instances?.length ?? 0) > 0;
            if (!childHasContent) return null;
            const groupDragOffset = multiDragDelta && inst.id !== multiDragDelta.anchorId && selectedInstanceIds.includes(inst.id)
              ? multiDragDelta
              : null;
            const box = computeInstanceBBox({
              ...inst,
              x: inst.x + (groupDragOffset?.dx ?? 0),
              y: inst.y + (groupDragOffset?.dy ?? 0),
            });
            if (!box) return null;
            const c1 = editToBasePoint(box.minX, box.minY);
            const c2 = editToBasePoint(box.maxX, box.maxY);
            const baseMinX = Math.min(c1.x, c2.x);
            const baseMaxX = Math.max(c1.x, c2.x);
            const baseMaxY = Math.max(c1.y, c2.y);
            const isPrimary = selectedInstanceId === inst.id;
            const tag = `${inst.name} · ${masterCell.cellName}`;
            const fs = 10.5 / stageScale;
            const pillW = Math.max(46 / stageScale, (tag.length * 6.3 + 12) / stageScale);
            const pillH = 17 / stageScale;
            return (
              <Group
                key={`sel-tag-${inst.id}`}
                x={((baseMinX + baseMaxX) / 2) * SCALE_FACTOR}
                y={baseMaxY * SCALE_FACTOR + 14 / stageScale}
                scaleY={-1}
                listening={false}
              >
                <Rect
                  x={-pillW / 2}
                  y={-pillH / 2}
                  width={pillW}
                  height={pillH}
                  cornerRadius={pillH / 2}
                  fill={isPrimary ? 'rgba(245, 158, 11, 0.94)' : 'rgba(56, 189, 248, 0.92)'}
                />
                <Text
                  text={tag}
                  x={-pillW / 2}
                  y={-pillH / 2}
                  width={pillW}
                  height={pillH}
                  align="center"
                  verticalAlign="middle"
                  fill="#ffffff"
                  fontSize={fs}
                  fontFamily={CANVAS_FONT_MONO}
                  fontStyle="bold"
                />
              </Group>
            );
          })}

          {/* Upright shape labels during Edit-in-Place (never upside-down on R180 or mirrored on MX/MY) */}
          {isEditInPlace && shapes.map((shape: LayoutShape) => {
            const preview = shapeResizePreview && shapeResizePreview.id === shape.id ? shapeResizePreview : null;
            const curX = preview ? preview.x : shape.x;
            const curY = preview ? preview.y : shape.y;
            const curW = preview ? preview.width : shape.width;
            const curH = preview ? preview.height : shape.height;
            const p1 = editToBasePoint(curX, curY);
            const p2 = editToBasePoint(curX + curW, curY + curH);
            const bMinX = Math.min(p1.x, p2.x) * SCALE_FACTOR;
            const bMaxY = Math.max(p1.y, p2.y) * SCALE_FACTOR;
            const bw = Math.abs(p2.x - p1.x) * SCALE_FACTOR;
            const bh = Math.abs(p2.y - p1.y) * SCALE_FACTOR;
            if (bw * stageScale < 34 || bh * stageScale < 20) return null;
            const isSelected = selectedShapeId === shape.id;
            const style = resolveLayerStyle(shape.layer, shape.purpose, shape.color);
            const tagText = shape.label?.trim()
              ? `${shape.label.trim()}\n${shape.layer}/${shape.purpose}`
              : `${shape.layer}/${shape.purpose}`;
            return (
              <Group key={`eip-shape-label-${shape.id}`} x={bMinX} y={bMaxY} scaleY={-1} listening={false}>
                <Text
                  text={tagText}
                  x={4 / stageScale}
                  y={Math.max(2 / stageScale, (bh - Math.min(13 / stageScale, bh * 0.28) * (shape.label?.trim() ? 2.3 : 1.2)) / 2)}
                  width={Math.max(1, bw - 8 / stageScale)}
                  align="center"
                  fill={isSelected ? '#92400e' : style.color}
                  fontSize={Math.min(12 / stageScale, Math.max(8 / stageScale, Math.min(bw * 0.14, bh * 0.24)))}
                  fontFamily={CANVAS_FONT_MONO}
                  fontStyle="bold"
                  lineHeight={1.25}
                  ellipsis={true}
                />
              </Group>
            );
          })}

          {/* Upright Create-Rect dimension readout */}
          {appMode === 'rect' && rectDraft && (() => {
            const draftRect = normalizeRectFromPoints(rectDraft.startX, rectDraft.startY, rectDraft.currentX, rectDraft.currentY, activeSnapStep, gridSize);
            if (!draftRect) return null;
            const activeStyle = resolveLayerStyle(activeDrawLayer, activeDrawPurpose, activeDrawColor);
            const p1 = editToBasePoint(draftRect.x, draftRect.y);
            const p2 = editToBasePoint(draftRect.x + draftRect.width, draftRect.y + draftRect.height);
            const bMinX = Math.min(p1.x, p2.x) * SCALE_FACTOR;
            const bMaxY = Math.max(p1.y, p2.y) * SCALE_FACTOR;
            const visW = Math.abs(p2.x - p1.x);
            const visH = Math.abs(p2.y - p1.y);
            const dimLabel = `${activeDrawLayer}/${activeDrawPurpose} · ${formatGridValue(visW, gridSize)} × ${formatGridValue(visH, gridSize)} µm`;
            return (
              <Group x={bMinX} y={bMaxY + 16 / stageScale} scaleY={-1} listening={false}>
                <Text
                  text={dimLabel}
                  fill={activeStyle.color}
                  fontSize={11.5 / stageScale}
                  fontFamily={CANVAS_FONT_MONO}
                  fontStyle="bold"
                />
              </Group>
            );
          })()}

          {/* Upright Stretch (S) live delta readout */}
          {stretchSession && (() => {
            const baseAnchor = editToBasePoint(stretchSession.anchorX, stretchSession.anchorY);
            const baseCurrent = editToBasePoint(stretchSession.currentX, stretchSession.currentY);
            const visDx = snapToGrid(baseCurrent.x - baseAnchor.x, gridSize);
            const visDy = snapToGrid(baseCurrent.y - baseAnchor.y, gridSize);
            const deltaText = `dX ${visDx >= 0 ? '+' : ''}${formatGridValue(visDx, gridSize)} · dY ${visDy >= 0 ? '+' : ''}${formatGridValue(visDy, gridSize)} µm`;
            return (
              <Group
                x={baseCurrent.x * SCALE_FACTOR + 10 / stageScale}
                y={baseCurrent.y * SCALE_FACTOR + 14 / stageScale}
                scaleY={-1}
                listening={false}
              >
                <Text
                  text={deltaText}
                  fill="#be185d"
                  fontSize={11.5 / stageScale}
                  fontFamily={CANVAS_FONT_MONO}
                  fontStyle="bold"
                />
              </Group>
            );
          })()}

          {/* Rulers (rendered upright in Base View space) */}
          {rulers.map(r => renderRuler(r, r.id, edgeAlignmentSession ? undefined : () => deleteRuler(r.id)))}
          {isMeasuring && currentRuler && renderRuler(currentRuler, 'temp_ruler')}

          {/* Gap Annotations (selection-based + auto-dim, rendered upright in Base View space) */}
          {renderGapAnnotations(
            edgeAlignmentSession ? null : selectedInstanceId,
            showAutoDim && !edgeAlignmentSession && !pixelArraySelected,
          )}

          {/* Grid-Locked Canvas Anchor Reticle & Measure Edge Snap Indicator */}
          {appMode === 'measure' && snapIndicator ? (
            <Group x={snapIndicator.x * SCALE_FACTOR} y={snapIndicator.y * SCALE_FACTOR} listening={false}>
              <Circle radius={4.5 / stageScale} stroke="#eab308" strokeWidth={1.6 / stageScale} />
              <Line points={[-9 / stageScale, 0, 9 / stageScale, 0]} stroke="#eab308" strokeWidth={1.1 / stageScale} />
              <Line points={[0, -9 / stageScale, 0, 9 / stageScale]} stroke="#eab308" strokeWidth={1.1 / stageScale} />
            </Group>
          ) : snappedMousePos && !isPanning && !isSpaceDown ? (
            <Group x={snappedMousePos.x * SCALE_FACTOR} y={snappedMousePos.y * SCALE_FACTOR} listening={false}>
              <Line points={[-7 / stageScale, 0, 7 / stageScale, 0]} stroke="#ffffff" strokeWidth={2.6 / stageScale} opacity={0.85} />
              <Line points={[0, -7 / stageScale, 0, 7 / stageScale]} stroke="#ffffff" strokeWidth={2.6 / stageScale} opacity={0.85} />
              <Line points={[-7 / stageScale, 0, 7 / stageScale, 0]} stroke="#0284c7" strokeWidth={1.25 / stageScale} />
              <Line points={[0, -7 / stageScale, 0, 7 / stageScale]} stroke="#0284c7" strokeWidth={1.25 / stageScale} />
              <Circle radius={2.2 / stageScale} fill="#0284c7" stroke="#ffffff" strokeWidth={1 / stageScale} />
            </Group>
          ) : null}
        </Layer>
      </Stage>
      {appMode === 'rect' && (
        <div className="lpp-palette-bar" role="toolbar" aria-label="Virtuoso Layer Purpose Palette">
          <div className="lpp-palette-bar__presets">
            {VIRTUOSO_LAYER_PRESETS.slice(0, 8).map(preset => {
              const isSelected = activeDrawLayer.toLowerCase() === preset.layer.toLowerCase()
                && activeDrawPurpose.toLowerCase() === preset.purpose.toLowerCase();
              return (
                <button
                  key={`${preset.layer}/${preset.purpose}`}
                  type="button"
                  className={`lpp-chip${isSelected ? ' active' : ''}`}
                  onClick={() => setActiveDrawLpp(preset.layer, preset.purpose)}
                  title={`Draw rectangle on ("${preset.layer}" "${preset.purpose}")`}
                >
                  <span className="lpp-chip__swatch" style={{ backgroundColor: preset.color }} />
                  <span>{preset.shortLabel}</span>
                </button>
              );
            })}
          </div>
          <span className="lpp-palette-bar__divider" aria-hidden="true" />
          <div className="lpp-palette-bar__custom">
            <input
              type="text"
              className="lpp-input"
              value={activeDrawLayer}
              onChange={e => setActiveDrawLpp(e.target.value, activeDrawPurpose, activeDrawColor)}
              placeholder="Layer"
              title="Cadence Layer Name (e.g. text, prBoundary, M1)"
              aria-label="Layer name"
            />
            <span className="lpp-sep">/</span>
            <input
              type="text"
              className="lpp-input"
              value={activeDrawPurpose}
              onChange={e => setActiveDrawLpp(activeDrawLayer, e.target.value, activeDrawColor)}
              placeholder="Purpose"
              title="Cadence Layer Purpose (e.g. drawing, pin, label)"
              aria-label="Layer purpose"
            />
            <input
              type="text"
              className="lpp-input lpp-input--label"
              value={activeDrawLabel}
              onChange={e => setActiveDrawLabel(e.target.value)}
              placeholder="Optional label…"
              title="Optional text label attached to new rectangles"
              aria-label="Optional rectangle label"
            />
          </div>
          <button
            type="button"
            className="lpp-close-btn"
            onClick={() => setAppMode('select')}
            title="Finish drawing rectangles (Esc)"
            aria-label="Exit rectangle tool"
          >
            <FiX />
          </button>
        </div>
      )}
      {appMode === 'measure' && (
        <div className="coordinate-overlay measure-mode-hint">
          Measure Mode · Click two snapped points · Press O for Ortho [{orthogonalRuler ? 'ON' : 'OFF'}] · Esc cancels
        </div>
      )}
      {appMode === 'pixel-array' && pendingPixelArraySize && (
        <div className="coordinate-overlay pixel-array-placement-hint">
          Pixel Array {formatGridValue(pendingPixelArraySize.width, gridSize)} × {formatGridValue(pendingPixelArraySize.height, gridSize)} um · Click inside {topCellName} to place · Esc cancels
        </div>
      )}
      {isEditInPlace && (
        <div className="eip-context-banner" role="status" aria-label="Edit in Place context">
          <span className="eip-context-banner__badge">EDIT IN PLACE</span>
          <span className="eip-context-banner__path">
            {baseCellName}
            {descendStack.map(frame => (
              <React.Fragment key={`${frame.instanceId}-${frame.cellId}`}>
                {' › '}
                <strong>{frame.instanceName}</strong> ({masterCells[frame.cellId]?.cellName ?? frame.cellId})
              </React.Fragment>
            ))}
          </span>
          <button
            type="button"
            className={`eip-context-banner__btn${showEditInPlaceContext ? ' active' : ''}`}
            onClick={toggleEditInPlaceContext}
            title={showEditInPlaceContext ? 'Hide dimmed surrounding context' : 'Show dimmed surrounding context'}
          >
            {showEditInPlaceContext ? <FiEye /> : <FiEyeOff />}
            <span>Context</span>
          </button>
          <button
            type="button"
            className="eip-context-banner__btn"
            onClick={ascendToParent}
            title="Return up one hierarchy level (Shift+B / Ctrl+B)"
          >
            <FiArrowUp />
            <span>Return</span>
          </button>
        </div>
      )}
      {appMode === 'stretch' && (
        <div className="coordinate-overlay stretch-mode-hint">
          {stretchSession
            ? (() => {
                const visDelta = isEditInPlace
                  ? applyCadenceOrientationVector(
                      eipForwardTransform.orientation,
                      stretchSession.currentX - stretchSession.anchorX,
                      stretchSession.currentY - stretchSession.anchorY,
                    )
                  : {
                      dx: stretchSession.currentX - stretchSession.anchorX,
                      dy: stretchSession.currentY - stretchSession.anchorY,
                    };
                return `Stretch (S) · Move pointer to target and click to finish · dX ${formatGridValue(visDelta.dx, gridSize)}, dY ${formatGridValue(visDelta.dy, gridSize)} µm · Esc cancels`;
              })()
            : hasPartialSelection(partialSelection)
              ? `Stretch (S) · ${countPartialSelectedEdges(partialSelection)} edge${countPartialSelectedEdges(partialSelection) === 1 ? '' : 's'} on ${countPartialSelectedShapes(partialSelection)} shape${countPartialSelectedShapes(partialSelection) === 1 ? '' : 's'} selected · Click-drag to stretch · Alt+Arrows nudge · Shift+drag adds edges · Esc clears`
              : 'Stretch (S) · Drag a box across rectangle edge(s)/corner(s) to partially select, or drag any edge directly · Esc exits'}
        </div>
      )}
      {appMode === 'select' && partialSelectMode && !edgeAlignmentSession && (
        <div className="coordinate-overlay stretch-mode-hint">
          {hasPartialSelection(partialSelection)
            ? `Partial Select (F4) · ${countPartialSelectedEdges(partialSelection)} edge${countPartialSelectedEdges(partialSelection) === 1 ? '' : 's'} selected · Press S to stretch · Alt+Arrows nudge · Shift+drag toggles edges · Esc clears`
            : 'Partial Select (F4) · Drag a box over rectangle edge(s)/corner(s) or click an edge, then press S to stretch'}
        </div>
      )}
      {isSubCellEmpty && appMode === 'select' && !partialSelectMode && !edgeAlignmentSession && (
        <div className="coordinate-overlay">
          Empty Virtuoso cellview ({topCellName}) · Press R to draw a rectangle (e.g. text/drawing) or I to instantiate a cell
        </div>
      )}
      {appMode === 'place' && placementMasterId && masterCells[placementMasterId] && (
        <div className="coordinate-overlay manual-pad-placement-hint">
          {masterCells[placementMasterId].kind === 'pad'
            ? (pendingManualPadGroup
                ? `Manual Pad Groups · Auto-rotate by nearest edge · ${pendingManualPadGroup.count} pads at ${pendingManualPadGroup.pitch} um pitch · Click each group location · Esc finishes`
                : `Pad Placement · ${masterCells[placementMasterId].libName}/${masterCells[placementMasterId].cellName} [${placementOrientation}] · Press R or Right-Click to rotate · Esc finishes`)
            : `Create Instance · ${masterCells[placementMasterId].libName}/${masterCells[placementMasterId].cellName}${pendingInstanceArray && (pendingInstanceArray.rows > 1 || pendingInstanceArray.cols > 1) ? ` (${pendingInstanceArray.rows}×${pendingInstanceArray.cols})` : ''} [${placementOrientation}] · Press R or Right-Click to rotate · Esc finishes`}
        </div>
      )}
      <div className="viewport-hud" aria-label="Viewport controls">
        {snappedMousePos && (
          <>
            <span className="viewport-hud__coords">
              X {formatGridValue(snappedMousePos.x, gridSize)} · Y {formatGridValue(snappedMousePos.y, gridSize)}
            </span>
            <span className="viewport-hud__divider" aria-hidden="true" />
          </>
        )}
        <button
          type="button"
          className="viewport-hud__btn"
          onClick={() => zoomAroundCenter(1 / 1.25)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <FiMinus />
        </button>
        <button
          type="button"
          className="viewport-hud__btn"
          onClick={fitView}
          title="Fit top cell to viewport (F)"
        >
          <FiMaximize2 /> {Math.max(1, Math.round((stageScale / fitScale) * 100))}%
        </button>
        <button
          type="button"
          className="viewport-hud__btn"
          onClick={() => zoomAroundCenter(1.25)}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <FiPlus />
        </button>
        <span className="viewport-hud__divider" aria-hidden="true" />
        <button
          type="button"
          className={`viewport-hud__btn${showGrid ? ' active' : ''}`}
          onClick={toggleGrid}
          title={`Toggle drafting grid (G) · Display step: ${formatGridValue(displayGrid.minorStep, gridSize)} µm (major ${formatGridValue(displayGrid.majorStep, gridSize)} µm)`}
          aria-pressed={showGrid}
        >
          <FiGrid /> Grid
        </button>
        <button
          type="button"
          className={`viewport-hud__btn${snapToVisibleGrid ? ' active' : ''}`}
          onClick={toggleSnapToVisibleGrid}
          title={
            snapToVisibleGrid
              ? `Anchor & placement locked to visible grid (${formatGridValue(activeSnapStep, gridSize)} µm, exact ${displayGrid.multiplier}× multiple of ${formatGridValue(gridSize, gridSize)} µm) · Click or press Shift+G for defined grid`
              : `Anchor & placement locked to defined grid (${formatGridValue(gridSize, gridSize)} µm) · Click or press Shift+G to lock onto visible grid lines (${formatGridValue(displayGrid.minorStep, gridSize)} µm)`
          }
          aria-pressed={snapToVisibleGrid}
        >
          <FiCrosshair /> {snapToVisibleGrid ? `Vis ${formatGridValue(activeSnapStep, gridSize)}` : `Snap ${formatGridValue(gridSize, gridSize)}`}
        </button>
      </div>
      {showAutoDim && appMode !== 'measure' && !pixelArraySelected && (
        <div className="autodim-legend">
          <span className="autodim-legend__swatch" />
          Nearest visible gaps · select a block to focus its local dimensions
        </div>
      )}
    </div>
  );
};
