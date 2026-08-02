import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Stage, Layer, Rect, Text, Group, Line, Circle } from 'react-konva';
import { useStore, clampInstancePosition, computePadGroupPositions, getTransformProps, PIXEL_ARRAY_ALIGNMENT_ID, rotateOrientationByQuarterTurns, snapPadToAutoOrientedEdge, snapPadToNearestEdge } from '../store/useStore';
import { getAlignmentEdgeAxis } from '../utils/alignment';
import type { AlignmentEdge } from '../utils/alignment';
import { formatGridValue } from '../utils/grid';
import { getIpPixelArrayEdgeMeasurements } from '../utils/pixelArrayDimensions';
import { resolveOrthogonalRulerEnd } from '../utils/ruler';
import type { SnapEdgeAxis } from '../utils/ruler';
import Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import './FloorplanCanvas.css';

const ZOOM_SPEED = 1.1;
export const SCALE_FACTOR = 100; // 1um = 100px on screen

export const FloorplanCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  
  // Konva cannot draw a zero-sized backing canvas during the first layout pass.
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 }); 
  const [stageScale, setStageScale] = useState(1);
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

  const { 
    appMode,
    setAppMode,
    topWidth,
    topHeight,
    topCellName,
    masterCells, 
    instances,
    rulers,
    gridSize, 
    updateInstancePosition,
    selectedInstanceId,
    selectedInstanceIds,
    setSelectedInstance,
    addRuler,
    deleteRuler,
    clearRulers,
    placementMasterId,
    placementOrientation,
    placeInstance,
    pendingManualPadGroup,
    placeManualPadGroup,
    rightSidebarPinned,
    setRightSidebarPinned,
    orthogonalRuler,
    showAutoDim,
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

  const fitView = useCallback(() => {
    if (containerRef.current) {
      const { offsetHeight, offsetWidth } = containerRef.current;
      const tw = topWidth * SCALE_FACTOR;
      const th = topHeight * SCALE_FACTOR;
      
      const padding = 100;
      const scaleX = (offsetWidth - padding * 2) / tw;
      const scaleY = (offsetHeight - padding * 2) / th;
      let initialScale = Math.min(scaleX, scaleY);
      if (initialScale > 1.5) initialScale = 1.5;
      
      setStageScale(initialScale);
      setStagePos({ 
        x: offsetWidth / 2, 
        y: offsetHeight / 2 
      }); 
    }
  }, [topWidth, topHeight]);

  useEffect(() => {
    fitView();
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight
        });
      }
    };
    setTimeout(updateSize, 50);
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [fitView]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      const key = e.key.toLowerCase();
      const state = useStore.getState();

      if (e.ctrlKey || e.metaKey) {
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
      }
      
      switch (key) {
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
          if (state.selectedInstanceId) {
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
        case 'backspace':
        case 'delete':
          if (state.selectedInstanceIds.length > 0) {
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
        case 'r':
          e.preventDefault();
          if (state.selectedInstanceId) {
            const instance = state.instances.find(item => item.id === state.selectedInstanceId);
            if (instance) {
              state.updateInstanceOrientation(
                instance.id,
                rotateOrientationByQuarterTurns(instance.orientation, e.shiftKey ? -1 : 1),
              );
            }
          }
          break;
        case 'a':
          e.preventDefault();
          if (state.pixelArraySelected) state.startEdgeAlignment(PIXEL_ARRAY_ALIGNMENT_ID);
          else if (state.selectedInstanceId) state.startEdgeAlignment(state.selectedInstanceId);
          break;
        case 'escape':
          if (state.edgeAlignmentSession) {
            state.cancelEdgeAlignment();
          } else if (state.appMode === 'place') {
            state.setPlacement(null);
          } else if (state.appMode === 'pixel-array') {
            state.setAppMode('select');
          } else if (appMode === 'measure') {
            setAppMode('select');
            setIsMeasuring(false);
            setCurrentRuler(null);
          } else if (selectedInstanceId) {
            setSelectedInstance(null);
          } else if (state.pixelArraySelected) {
            state.setPixelArraySelected(false);
          }
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [appMode, selectedInstanceId, rightSidebarPinned, clearRulers, fitView, setAppMode, setSelectedInstance]);

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

    const newScale = e.evt.deltaY < 0 ? oldScale * ZOOM_SPEED : oldScale / ZOOM_SPEED;
    setStageScale(newScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * -newScale,
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

  const getInstanceCorners = (inst: any) => {
    const master = masterCells[inst.cellId];
    if (!master) return null;
    const t = getTransformProps(inst.orientation);
    const rad = t.rotation * Math.PI / 180;
    const cos = Math.round(Math.cos(rad));
    const sin = Math.round(Math.sin(rad));
    const w = master.width;
    const h = master.height;

    const transformPoint = (px: number, py: number) => {
      let sx = px * t.scaleX;
      let sy = py * t.scaleY;
      let rx = sx * cos - sy * sin;
      let ry = sx * sin + sy * cos;
      return { x: inst.x + rx, y: inst.y + ry };
    };

    return [
      transformPoint(0, 0),
      transformPoint(w, 0),
      transformPoint(w, h),
      transformPoint(0, h)
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
      
      // top_asic boundary
      const w2 = topWidth / 2;
      const h2 = topHeight / 2;
      const topAsicCorners = [
        {x: -w2, y: -h2},
        {x: w2, y: -h2},
        {x: w2, y: h2},
        {x: -w2, y: h2}
      ];
      for (let i=0; i<4; i++) {
        const a = topAsicCorners[i];
        const b = topAsicCorners[(i+1)%4];
        segments.push({ a, b, axis: Math.abs(a.x - b.x) <= 1e-9 ? 'vertical' : 'horizontal' });
      }

      // instances
      for (const inst of instances) {
        const corners = getInstanceCorners(inst);
        if (!corners) continue;
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
            bestSnap = { ...closest, snapEdgeAxis: seg.axis };
          }
        }
      }

      if (bestSnap) {
        return { umX: bestSnap.x, umY: bestSnap.y, isSnapped: true, snapEdgeAxis: bestSnap.snapEdgeAxis };
      }
    }

    umX = Math.round(umX / gridSize) * gridSize;
    umY = Math.round(umY / gridSize) * gridSize;
    return { umX, umY, isSnapped: false, snapEdgeAxis: undefined };
  };

  const handleMouseDown = () => {
    if (isPanning) return;
  };

  const handleMouseMove = () => {
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    const { umX, umY, isSnapped, snapEdgeAxis } = getSnappedWorldPos(pointer, appMode === 'measure');

    setMousePos({ x: umX, y: umY });
    
    if (appMode === 'measure' && isSnapped) {
      setSnapIndicator({ x: umX, y: umY });
    } else {
      setSnapIndicator(null);
    }

    if (appMode === 'measure' && isMeasuring && measureStart) {
      const end = resolveOrthogonalRulerEnd(
        measureStart,
        { x: umX, y: umY, snapEdgeAxis: isSnapped ? snapEdgeAxis : undefined },
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

  const handleMouseLeave = () => {
    setMousePos(null);
  };

  // Drag bound logic: compute physical bounds, clamp them in real-time, then snap to grid
  const dragBoundFunc = (pos: {x: number, y: number}, cellId: string, orientation: string) => {
    const master = masterCells[cellId];
    if (!master) return pos;

    const t = getTransformProps(orientation);
    const rad = t.rotation * Math.PI / 180;
    const cos = Math.round(Math.cos(rad));
    const sin = Math.round(Math.sin(rad));

    const w = master.width;
    const h = master.height;

    const transformPoint = (px: number, py: number) => {
      let sx = px * t.scaleX;
      let sy = py * t.scaleY;
      let rx = sx * cos - sy * sin;
      let ry = sx * sin + sy * cos;
      return { x: rx, y: ry };
    };

    const p1 = transformPoint(0, 0);
    const p2 = transformPoint(w, 0);
    const p3 = transformPoint(w, h);
    const p4 = transformPoint(0, h);

    const minX = Math.min(p1.x, p2.x, p3.x, p4.x);
    const maxX = Math.max(p1.x, p2.x, p3.x, p4.x);
    const minY = Math.min(p1.y, p2.y, p3.y, p4.y);
    const maxY = Math.max(p1.y, p2.y, p3.y, p4.y);

    const minAllowedX = -topWidth / 2 - minX;
    const maxAllowedX = topWidth / 2 - maxX;
    const minAllowedY = -topHeight / 2 - minY;
    const maxAllowedY = topHeight / 2 - maxY;

    // Convert requested pixel position to world um
    const worldX = (pos.x - stagePos.x) / stageScale;
    const worldY = (pos.y - stagePos.y) / -stageScale;
    let umX = worldX / SCALE_FACTOR;
    let umY = worldY / SCALE_FACTOR;

    if (master.kind === 'pad') {
      const snapped = snapPadToNearestEdge(
        umX,
        umY,
        master.width,
        master.height,
        topWidth,
        topHeight,
        gridSize,
        orientation,
      );
      return {
        x: snapped.x * SCALE_FACTOR * stageScale + stagePos.x,
        y: snapped.y * SCALE_FACTOR * -stageScale + stagePos.y,
      };
    }

    // Clamp
    umX = Math.max(minAllowedX, Math.min(umX, maxAllowedX));
    umY = Math.max(minAllowedY, Math.min(umY, maxAllowedY));

    // Snap to grid
    umX = Math.round(umX / gridSize) * gridSize;
    umY = Math.round(umY / gridSize) * gridSize;

    // Convert back to pixels
    const pxX = umX * SCALE_FACTOR * stageScale + stagePos.x;
    const pxY = umY * SCALE_FACTOR * -stageScale + stagePos.y;

    return { x: pxX, y: pxY };
  };

  const handleDragEnd = (e: KonvaEventObject<DragEvent>, instanceId: string) => {
    const node = e.target;
    const umX = node.x() / SCALE_FACTOR;
    const umY = node.y() / SCALE_FACTOR;
    updateInstancePosition(instanceId, umX, umY);
  };

  // ----------------------------------------------------------------
  // Gap annotation helpers
  // ----------------------------------------------------------------
  type BBox = { minX: number; maxX: number; minY: number; maxY: number };

  const computeInstanceBBox = (inst: typeof instances[0]): BBox | null => {
    const m = masterCells[inst.cellId];
    if (!m) return null;
    const t = getTransformProps(inst.orientation);
    const rad = t.rotation * Math.PI / 180;
    const cos = Math.round(Math.cos(rad));
    const sin = Math.round(Math.sin(rad));
    const corners = [[0,0],[m.width,0],[m.width,m.height],[0,m.height]].map(([px,py]) => {
      const sx = px * t.scaleX;
      const sy = py * t.scaleY;
      return { x: inst.x + sx*cos - sy*sin, y: inst.y + sx*sin + sy*cos };
    });
    return {
      minX: Math.min(...corners.map(c=>c.x)),
      maxX: Math.max(...corners.map(c=>c.x)),
      minY: Math.min(...corners.map(c=>c.y)),
      maxY: Math.max(...corners.map(c=>c.y)),
    };
  };

  const renderGapAnnotations = (selectedId: string | null, autoMode: boolean) => {
    const sf = SCALE_FACTOR;
    const SEL_COLOR  = '#38bdf8'; // sky-blue for selected cell gaps
    const AUTO_COLOR = '#a78bfa'; // violet for auto-dim
    const annotations: React.ReactNode[] = [];
    const topBox: BBox = { minX: -topWidth/2, maxX: topWidth/2, minY: -topHeight/2, maxY: topHeight/2 };

    // Renders a dimension line between two points (in um coords).
    // perpDir: 'up' | 'down' | 'left' | 'right' — which side the label goes.
    const renderDimLine = (
      x1: number, y1: number,
      x2: number, y2: number,
      label: string, color: string, key: string,
      perpDir: 'up' | 'down' | 'left' | 'right' = 'up',
      interactive = false,
    ) => {
      const isHoriz = Math.abs(y2 - y1) < 0.0001;
      const isVert  = Math.abs(x2 - x1) < 0.0001;
      const tickLen = 6 / stageScale;
      const labelGap = 12 / stageScale;
      const fs = 10.5 / stageScale;

      // midpoint in canvas px
      const mx = ((x1 + x2) / 2) * sf;
      const my = ((y1 + y2) / 2) * sf;

      // label offset: in canvas space, +Y is "up" (because stage scaleY=-1)
      let lx = mx, ly = my;
      if (perpDir === 'up')    ly = my + labelGap;
      if (perpDir === 'down')  ly = my - labelGap;
      if (perpDir === 'right') lx = mx + labelGap;
      if (perpDir === 'left')  lx = mx - labelGap;
      const isHovered = interactive && hoveredAutoDimKey === key;
      const isMuted = interactive && hoveredAutoDimKey !== null && !isHovered;
      const strokeWidth = (isHovered ? 1.5 : 0.9) / stageScale;

      return (
        <Group
          key={key}
          listening={interactive}
          opacity={isMuted ? 0.14 : interactive && !isHovered ? 0.72 : 1}
          onMouseEnter={interactive ? () => setHoveredAutoDimKey(key) : undefined}
          onMouseLeave={interactive ? () => setHoveredAutoDimKey(null) : undefined}
        >
          {/* Main dim line */}
          <Line
            points={[x1*sf, y1*sf, x2*sf, y2*sf]}
            stroke={color}
            strokeWidth={strokeWidth}
            dash={[4/stageScale, 4/stageScale]}
            hitStrokeWidth={interactive ? 14 / stageScale : undefined}
          />
          {/* Perpendicular end ticks */}
          {isHoriz && <>
            <Line points={[x1*sf, y1*sf - tickLen, x1*sf, y1*sf + tickLen]} stroke={color} strokeWidth={1/stageScale} />
            <Line points={[x2*sf, y2*sf - tickLen, x2*sf, y2*sf + tickLen]} stroke={color} strokeWidth={1/stageScale} />
          </>}
          {isVert && <>
            <Line points={[x1*sf - tickLen, y1*sf, x1*sf + tickLen, y1*sf]} stroke={color} strokeWidth={1/stageScale} />
            <Line points={[x2*sf - tickLen, y2*sf, x2*sf + tickLen, y2*sf]} stroke={color} strokeWidth={1/stageScale} />
          </>}
          {/* Label — rendered with scaleY=-1 to flip text upright */}
          <Text
            x={lx}
            y={ly}
            text={label}
            fill={color}
            stroke="rgba(15, 23, 42, 0.78)"
            strokeWidth={1.25 / stageScale}
            lineJoin="round"
            fontSize={fs}
            fontFamily="Inter"
            fontStyle="normal"
            scaleY={-1}
            offsetY={isHoriz ? -fs * 0.2 : fs * 0.5}
            align={isHoriz ? 'center' : 'left'}
            listening={interactive}
          />
        </Group>
      );
    };

    const snapLabel = (v: number) => {
      const snapped = Math.round(v / gridSize) * gridSize;
      return formatGridValue(snapped, gridSize) + ' um';
    };

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
        if (selBox) {
          const others = instances
            .filter(i => i.id !== selectedId)
            .map(i => ({ id: i.id, name: i.name, box: computeInstanceBBox(i) }))
            .filter(x => x.box !== null) as { id: string; name: string; box: BBox }[];

          type Direction = 'right' | 'left' | 'top' | 'bottom';

          const renderVisibleNeighbors = (direction: Direction) => {
            const horizontal = direction === 'right' || direction === 'left';
            const projectionStart = horizontal ? selBox.minY : selBox.minX;
            const projectionEnd = horizontal ? selBox.maxY : selBox.maxX;

            const instanceCandidates = others.flatMap(other => {
              const ob = other.box;
              let distance: number;

              if (direction === 'right') distance = ob.minX - selBox.maxX;
              else if (direction === 'left') distance = selBox.minX - ob.maxX;
              else if (direction === 'top') distance = ob.minY - selBox.maxY;
              else distance = selBox.minY - ob.maxY;

              if (distance < -0.0001) return [];

              const overlapStart = Math.max(
                projectionStart,
                horizontal ? ob.minY : ob.minX
              );
              const overlapEnd = Math.min(
                projectionEnd,
                horizontal ? ob.maxY : ob.maxX
              );
              if (overlapEnd - overlapStart <= 0.0001) return [];

              return [{ ...other, distance, overlap: { start: overlapStart, end: overlapEnd }, occludes: true, relationship: 'gap' as const }];
            });

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
                segment.end - segment.start > largest.end - largest.start ? segment : largest
              );
              const projectionCenter = (largestVisibleSegment.start + largestVisibleSegment.end) / 2;

              // A touching IP still occludes anything behind it, but has no positive gap to label.
              if (candidate.distance > 0.0001) {
                const label = candidate.relationship === 'overlap'
                  ? `${snapLabel(candidate.distance)} overlap`
                  : candidate.relationship === 'inside'
                    ? `${snapLabel(candidate.distance)} to array edge`
                    : `${snapLabel(candidate.distance)} to ${candidate.name}`;
                const key = `gap-${direction}-${candidate.id}`;

                if (direction === 'right') {
                  annotations.push(renderDimLine(selBox.maxX, projectionCenter, candidate.box.minX, projectionCenter, label, SEL_COLOR, key, 'up'));
                } else if (direction === 'left') {
                  annotations.push(renderDimLine(candidate.box.maxX, projectionCenter, selBox.minX, projectionCenter, label, SEL_COLOR, key, 'up'));
                } else if (direction === 'top') {
                  annotations.push(renderDimLine(projectionCenter, selBox.maxY, projectionCenter, candidate.box.minY, label, SEL_COLOR, key, 'right'));
                } else {
                  annotations.push(renderDimLine(projectionCenter, candidate.box.maxY, projectionCenter, selBox.minY, label, SEL_COLOR, key, 'right'));
                }
              }

              // Nearer IPs hide farther IPs only across the projection they actually cover.
              // The pixel array is translucent and may overlap IPs, so it never hides IP relationships.
              if (candidate.occludes) covered = addCoveredInterval(covered, candidate.overlap);
            });

            // Keep the original chip-edge dimension when no IP overlaps this side at all.
            if (!hasVisibleNeighbor) {
              const projectionCenter = (projectionStart + projectionEnd) / 2;
              if (direction === 'right') {
                const gap = topBox.maxX - selBox.maxX;
                if (gap > 0.0001) annotations.push(renderDimLine(selBox.maxX, projectionCenter, topBox.maxX, projectionCenter, snapLabel(gap), SEL_COLOR, 'gap-right-boundary', 'up'));
              } else if (direction === 'left') {
                const gap = selBox.minX - topBox.minX;
                if (gap > 0.0001) annotations.push(renderDimLine(topBox.minX, projectionCenter, selBox.minX, projectionCenter, snapLabel(gap), SEL_COLOR, 'gap-left-boundary', 'up'));
              } else if (direction === 'top') {
                const gap = topBox.maxY - selBox.maxY;
                if (gap > 0.0001) annotations.push(renderDimLine(projectionCenter, selBox.maxY, projectionCenter, topBox.maxY, snapLabel(gap), SEL_COLOR, 'gap-top-boundary', 'right'));
              } else {
                const gap = selBox.minY - topBox.minY;
                if (gap > 0.0001) annotations.push(renderDimLine(projectionCenter, topBox.minY, projectionCenter, selBox.minY, snapLabel(gap), SEL_COLOR, 'gap-bottom-boundary', 'right'));
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

    // A selected block already has focused dimensions. Suppress the global layer
    // until selection is cleared so local relationships remain easy to scan.
    if (autoMode && !selectedId) {
      const allBoxes = instances
        .map(i => ({ id: i.id, name: i.name, box: computeInstanceBBox(i) }))
        .filter(x => x.box !== null) as { id: string; name: string; box: BBox }[];
      const seenPairs = new Set<string>();

      type AutoDirection = 'right' | 'left' | 'top' | 'bottom';
      allBoxes.forEach(source => {
        (['right', 'left', 'top', 'bottom'] as AutoDirection[]).forEach(direction => {
          const horizontal = direction === 'right' || direction === 'left';
          const candidates = allBoxes.flatMap(target => {
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

            let gap: number;
            if (direction === 'right') gap = target.box.minX - source.box.maxX;
            else if (direction === 'left') gap = source.box.minX - target.box.maxX;
            else if (direction === 'top') gap = target.box.minY - source.box.maxY;
            else gap = source.box.minY - target.box.maxY;
            if (gap <= 0.0001) return [];

            return [{ target, gap, projectionCenter: (overlapStart + overlapEnd) / 2 }];
          }).sort((a, b) => a.gap - b.gap);

          const nearest = candidates[0];
          if (!nearest) return;
          const pairKey = [source.id, nearest.target.id].sort().join('|');
          if (seenPairs.has(pairKey) || source.id === selectedId || nearest.target.id === selectedId) return;
          seenPairs.add(pairKey);

          const label = `${source.name} ↔ ${nearest.target.name} · ${snapLabel(nearest.gap)}`;
          const key = `auto-${horizontal ? 'h' : 'v'}-${pairKey}`;
          if (direction === 'right') {
            annotations.push(renderDimLine(source.box.maxX, nearest.projectionCenter, nearest.target.box.minX, nearest.projectionCenter, label, AUTO_COLOR, key, 'up', true));
          } else if (direction === 'left') {
            annotations.push(renderDimLine(nearest.target.box.maxX, nearest.projectionCenter, source.box.minX, nearest.projectionCenter, label, AUTO_COLOR, key, 'up', true));
          } else if (direction === 'top') {
            annotations.push(renderDimLine(nearest.projectionCenter, source.box.maxY, nearest.projectionCenter, nearest.target.box.minY, label, AUTO_COLOR, key, 'right', true));
          } else {
            annotations.push(renderDimLine(nearest.projectionCenter, nearest.target.box.maxY, nearest.projectionCenter, source.box.minY, label, AUTO_COLOR, key, 'right', true));
          }
        });
      });
    }

    return annotations;
  };


  const renderRuler = (r: { id?: string; startX: number, startY: number, endX: number, endY: number, referenceX?: number, referenceY?: number }, key: string, onDelete?: () => void) => {
    const sx = r.startX * SCALE_FACTOR;
    const sy = r.startY * SCALE_FACTOR;
    const ex = r.endX * SCALE_FACTOR;
    const ey = r.endY * SCALE_FACTOR;
    const referenceX = r.referenceX !== undefined ? r.referenceX * SCALE_FACTOR : null;
    const referenceY = r.referenceY !== undefined ? r.referenceY * SCALE_FACTOR : null;
    const hasReferenceExtension = referenceX !== null && referenceY !== null
      && (Math.abs(referenceX - ex) > 1e-6 || Math.abs(referenceY - ey) > 1e-6);
    const isHovered = r.id != null && hoveredRulerId === r.id;
    const rulerColor = isHovered ? '#fbbf24' : '#eab308';
    
    const dx = r.endX - r.startX;
    const dy = r.endY - r.startY;
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
        const strVal = parseFloat(tickDist.toFixed(4)).toString();
        texts.push(
          <Text
            key={`tick-text-${key}-${i}`}
            x={tx + nx * 10 / stageScale}
            y={ty + ny * 10 / stageScale}
            text={strVal}
            fill={rulerColor}
            fontSize={12 / stageScale}
            fontFamily="monospace"
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
          fontFamily="monospace"
          scaleY={-1}
          offsetY={-6 / stageScale}
        />
      );

      // End text (Total length)
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      const finalDist = parseFloat((Math.round(dist / gridSize) * gridSize).toFixed(4)).toString();
      
      let endTextString = `L: ${finalDist}`;
      if (absDx > 0.0001 && absDy > 0.0001) {
        const finalDx = parseFloat((Math.round(absDx / gridSize) * gridSize).toFixed(4)).toString();
        const finalDy = parseFloat((Math.round(absDy / gridSize) * gridSize).toFixed(4)).toString();
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
          fontFamily="monospace"
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
            fontFamily="Inter"
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

  const tw = topWidth * SCALE_FACTOR;
  const th = topHeight * SCALE_FACTOR;

  return (
    <div className="canvas-container" ref={containerRef}>
      <Stage
        width={dimensions.width}
        height={dimensions.height}
        onWheel={handleWheel}
        draggable={appMode === 'select' && !edgeAlignmentSession}
        onDragStart={() => setIsPanning(true)}
        onDragEnd={() => setIsPanning(false)}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        x={stagePos.x}
        y={stagePos.y}
        scaleX={stageScale}
        scaleY={-stageScale} 
        onDragMove={(e) => {
          if (e.target.className === 'Stage') {
            setStagePos({ x: e.target.x(), y: e.target.y() });
          }
        }}
        onDblClick={(e) => {
          if (appMode !== 'select') return;
          let node = e.target as Konva.Node | null;
          while (node) {
            const id = node.id();
            if (id && instances.some(instance => instance.id === id)) {
              setSelectedInstance(id);
              setRightSidebarPinned(true);
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
          
          if (appMode === 'measure' && snapped) {
            if (!isMeasuring) {
              setIsMeasuring(true);
              setMeasureStart({ x: snapped.umX, y: snapped.umY, snapEdgeAxis: snapped.snapEdgeAxis });
              setCurrentRuler({ startX: snapped.umX, startY: snapped.umY, endX: snapped.umX, endY: snapped.umY });
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
          } else if (appMode === 'place' && placementMasterId && snapped) {
            try {
              if (pendingManualPadGroup) placeManualPadGroup(snapped.umX, snapped.umY);
              else placeInstance(placementMasterId, snapped.umX, snapped.umY, placementOrientation);
            } catch (error) {
              alert(error instanceof Error ? error.message : 'Unable to place the selected cell.');
            }
          } else if (appMode === 'pixel-array' && pendingPixelArraySize && snapped) {
            placePixelArray(snapped.umX, snapped.umY);
          } else if (appMode === 'select' && !edgeAlignmentSession && (e.target === e.target.getStage() || e.target.name() === 'bg' || e.target.name() === 'overlay')) {
            if (!e.evt.shiftKey) setSelectedInstance(null);
          }
        }}
        ref={stageRef}
        style={{ 
          cursor: edgeAlignmentSession || appMode === 'measure' || appMode === 'pixel-array' ? 'crosshair' : (isPanning ? 'grabbing' : 'grab')
        }}
      >
        <Layer>
          {/* Infinite Background for panning */}
          <Rect 
            name="bg"
            x={-1000000} 
            y={-1000000} 
            width={2000000} 
            height={2000000} 
            fill="transparent" 
          />

          {/* Top ASIC boundary and background */}
          <Rect 
            x={-tw / 2} 
            y={-th / 2} 
            width={tw} 
            height={th} 
            fill="#ffffff"
            stroke="#475569" 
            strokeWidth={2 / stageScale}
            dash={[10 / stageScale, 10 / stageScale]}
            shadowColor="rgba(0,0,0,0.1)"
            shadowBlur={10 / stageScale}
          />

          {pixelArray?.visible && (
            <Group
              name="pixel-array"
              x={pixelArray.x * SCALE_FACTOR}
              y={pixelArray.y * SCALE_FACTOR}
              draggable={appMode === 'select' && !edgeAlignmentSession}
              onClick={(event) => {
                event.cancelBubble = true;
                if (appMode === 'select' && !edgeAlignmentSession) setPixelArraySelected(true);
              }}
              onDragStart={() => setPixelArraySelected(true)}
              onDragEnd={(event) => updatePixelArrayPosition(
                event.target.x() / SCALE_FACTOR,
                event.target.y() / SCALE_FACTOR,
              )}
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
                fontFamily="Inter"
                fontStyle="bold"
                lineHeight={1.35}
                scaleY={-1}
                listening={false}
              />
            </Group>
          )}

          {appMode === 'pixel-array' && pendingPixelArraySize && mousePos && (() => {
            try {
              const position = clampInstancePosition(
                mousePos.x - pendingPixelArraySize.width / 2,
                mousePos.y - pendingPixelArraySize.height / 2,
                'R0',
                pendingPixelArraySize.width,
                pendingPixelArraySize.height,
                topWidth,
                topHeight,
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

          {/* Grid Axes (Infinite lines) */}
          <Line points={[-100000, 0, 100000, 0]} stroke="#cbd5e1" strokeWidth={1 / stageScale} opacity={0.8} />
          <Line points={[0, -100000, 0, 100000]} stroke="#cbd5e1" strokeWidth={1 / stageScale} opacity={0.8} />
          <Text
            text={`${topCellName} (${topWidth}um x ${topHeight}um)`}
            x={-tw / 2}
            y={th / 2 + 25 / stageScale}
            fill="#94a3b8"
            fontSize={16 / stageScale}
            fontFamily="Inter"
            scaleY={-1}
          />
          {/* Top Right Coordinate */}
          <Text
            text={`(${topWidth/2}, ${topHeight/2})`}
            x={tw / 2 - 200 / stageScale}
            y={th / 2 + 25 / stageScale}
            width={200 / stageScale}
            align="right"
            fill="#94a3b8"
            fontSize={12 / stageScale}
            fontFamily="Inter"
            scaleY={-1}
          />
          {/* Bottom Left Coordinate */}
          <Text
            text={`(${-topWidth/2}, ${-topHeight/2})`}
            x={-tw / 2}
            y={-th / 2 - 10 / stageScale}
            fill="#94a3b8"
            fontSize={12 / stageScale}
            fontFamily="Inter"
            scaleY={-1}
          />
        </Layer>
        
        <Layer>
          {[...instances].sort((a, b) => {
            const mA = masterCells[a.cellId];
            const mB = masterCells[b.cellId];
            if (!mA || !mB) return 0;
            return (mB.width * mB.height) - (mA.width * mA.height);
          }).map(inst => {
            const masterCell = masterCells[inst.cellId];
            if (!masterCell) return null;
            const w = masterCell.width * SCALE_FACTOR;
            const h = masterCell.height * SCALE_FACTOR;
            const isSelected = selectedInstanceIds.includes(inst.id);
            const isPrimarySelection = selectedInstanceId === inst.id;

            const t = getTransformProps(inst.orientation);
            const outlineStyle = masterCell.outlineStyle ?? 'solid';
            const outlineDash = outlineStyle === 'dashed'
              ? [8 / stageScale, 6 / stageScale]
              : outlineStyle === 'dotted' ? [1.5 / stageScale, 4 / stageScale] : undefined;

            return (
              <Group
                key={inst.id}
                id={inst.id}
                x={inst.x * SCALE_FACTOR}
                y={inst.y * SCALE_FACTOR}
                rotation={t.rotation}
                scaleX={t.scaleX}
                scaleY={t.scaleY}
                draggable={appMode === 'select' && !edgeAlignmentSession}
                dragBoundFunc={(pos) => dragBoundFunc(pos, inst.cellId, inst.orientation)}
                onDragEnd={(e) => handleDragEnd(e, inst.id)}
                onClick={(e) => {
                  e.cancelBubble = true;
                  if (appMode === 'select' && !edgeAlignmentSession) {
                    setSelectedInstance(inst.id, e.evt.shiftKey);
                  }
                }}
                onContextMenu={(e) => {
                  e.evt.preventDefault();
                  e.cancelBubble = true;
                  if (appMode !== 'select' || edgeAlignmentSession) return;
                  setSelectedInstance(inst.id);
                  useStore.getState().updateInstanceOrientation(
                    inst.id,
                    rotateOrientationByQuarterTurns(inst.orientation, e.evt.shiftKey ? -1 : 1),
                  );
                }}
              >
                <Rect
                  width={w}
                  height={h}
                  fill={masterCell.color}
                  opacity={masterCell.opacity ?? 0.5}
                />
                {outlineStyle !== 'none' && (
                  <Rect
                    width={w}
                    height={h}
                    fillEnabled={false}
                    stroke="#334155"
                    strokeWidth={1 / stageScale}
                    dash={outlineDash}
                    listening={false}
                  />
                )}
                {isSelected && (
                  <Rect
                    width={w}
                    height={h}
                    fillEnabled={false}
                    stroke={isPrimarySelection ? '#f59e0b' : '#38bdf8'}
                    strokeWidth={3 / stageScale}
                    listening={false}
                  />
                )}
                
                {(() => {
                  // Compute a fontSize that is always readable:
                  // - In world-space (before stage scale) we want ~10% of the shorter side
                  // - Clamp so it's never smaller than 8 screen-px or larger than 30% of cell
                  const shortSide = Math.min(w, h);
                  const longSide = Math.max(w, h);
                  const fontSizeWorld = Math.min(shortSide * 0.18, longSide * 0.1);
                  // Only render if the cell is big enough on screen
                  const screenH = h * stageScale;
                  const screenW = w * stageScale;
                  if (screenH < 24 || screenW < 30) return null;

                  const nameFS = fontSizeWorld;
                  const subFS = fontSizeWorld * 0.65;
                  const instFS = fontSizeWorld * 0.6;
                  const totalTextH = nameFS + subFS * 1.3 + instFS * 1.3;
                  const startY = (h - totalTextH) / 2;

                  return (
                    <Group scaleY={-1} offsetY={h}>
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
                          fontFamily="Inter"
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
                        fontFamily="Inter"
                        fontStyle="bold"
                        ellipsis={true}
                        wrap="none"
                      />
                      {/* Size (sub-label) */}
                      {screenH > 36 && (
                        <Text
                          text={`${masterCell.width} × ${masterCell.height} um`}
                          x={0}
                          y={startY + (screenH > 48 ? instFS * 1.3 : 0) + nameFS * 1.3}
                          width={w}
                          align="center"
                          fill="rgba(10, 20, 40, 0.6)"
                          fontSize={subFS}
                          fontFamily="Inter"
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

            if (!sourceAxis) return [...ipEdges, ...pixelArrayEdges];
            const boundaryEdges: AlignmentEdge[] = sourceAxis === 'horizontal'
              ? ['left', 'right']
              : ['bottom', 'top'];
            const boundaryBox: BBox = {
              minX: -topWidth / 2,
              maxX: topWidth / 2,
              minY: -topHeight / 2,
              maxY: topHeight / 2,
            };
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

          {/* Rulers */}
          {rulers.map(r => renderRuler(r, r.id, edgeAlignmentSession ? undefined : () => deleteRuler(r.id)))}
          {isMeasuring && currentRuler && renderRuler(currentRuler, 'temp_ruler')}

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

          {/* Gap Annotations (selection-based + auto-dim) */}
          {renderGapAnnotations(
            edgeAlignmentSession ? null : selectedInstanceId,
            showAutoDim && !edgeAlignmentSession && !pixelArraySelected,
          )}

          {/* Snap Indicator */}
          {appMode === 'measure' && snapIndicator && (
            <Group x={snapIndicator.x * SCALE_FACTOR} y={snapIndicator.y * SCALE_FACTOR}>
              <Circle radius={4 / stageScale} stroke="#eab308" strokeWidth={1.5 / stageScale} />
              <Line points={[-8 / stageScale, 0, 8 / stageScale, 0]} stroke="#eab308" strokeWidth={1 / stageScale} />
              <Line points={[0, -8 / stageScale, 0, 8 / stageScale]} stroke="#eab308" strokeWidth={1 / stageScale} />
            </Group>
          )}

          {/* Ghost Placement Group */}
          {appMode === 'place' && placementMasterId && masterCells[placementMasterId] && mousePos && (() => {
            const m = masterCells[placementMasterId];
            let previewOrientation = placementOrientation;
            let ghostPosition = mousePos;
            if (m.kind === 'pad') {
              try {
                if (pendingManualPadGroup) {
                  const snapped = snapPadToAutoOrientedEdge(mousePos.x, mousePos.y, m.width, m.height, topWidth, topHeight, gridSize);
                  previewOrientation = snapped.orientation;
                  const t = getTransformProps(previewOrientation);
                  const horizontal = snapped.side === 'top' || snapped.side === 'bottom';
                  const centerAlong = horizontal ? mousePos.x : mousePos.y;
                  const positions = computePadGroupPositions({
                    width: m.width, height: m.height, count: pendingManualPadGroup.count,
                    pitch: pendingManualPadGroup.pitch, side: snapped.side, centerAlong,
                    orientation: previewOrientation, topWidth, topHeight, gridSize,
                  });
                  return <>{positions.map((position, index) => (
                    <Group
                      key={`manual-pad-ghost-${index}`}
                      x={position.x * SCALE_FACTOR}
                      y={position.y * SCALE_FACTOR}
                      rotation={t.rotation}
                      scaleX={t.scaleX}
                      scaleY={t.scaleY}
                      opacity={0.5}
                      listening={false}
                    >
                      <Rect
                        width={m.width * SCALE_FACTOR}
                        height={m.height * SCALE_FACTOR}
                        fill={m.color}
                        stroke="#f8fafc"
                        strokeWidth={2 / stageScale}
                        dash={[5 / stageScale, 5 / stageScale]}
                      />
                    </Group>
                  ))}</>;
                }
                ghostPosition = snapPadToNearestEdge(mousePos.x, mousePos.y, m.width, m.height, topWidth, topHeight, gridSize, placementOrientation);
              } catch {
                return null;
              }
            }
            const t = getTransformProps(previewOrientation);
            return (
              <Group
                x={ghostPosition.x * SCALE_FACTOR}
                y={ghostPosition.y * SCALE_FACTOR}
                rotation={t.rotation}
                scaleX={t.scaleX}
                scaleY={t.scaleY}
                opacity={0.5}
                listening={false}
              >
                <Rect
                  width={m.width * SCALE_FACTOR}
                  height={m.height * SCALE_FACTOR}
                  fill={m.color}
                  stroke="#f8fafc"
                  strokeWidth={2 / stageScale}
                  dash={[5 / stageScale, 5 / stageScale]}
                  opacity={0.5}
                />
                {(() => {
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
                    <Group scaleY={-1} offsetY={h}>
                      <Text
                        text={m.cellName}
                        x={0}
                        y={startY}
                        width={w}
                        align="center"
                        fill="rgba(10, 20, 40, 0.9)"
                        fontSize={nameFS}
                        fontFamily="Inter"
                        fontStyle="bold"
                        ellipsis={true}
                        wrap="none"
                      />
                      {screenH > 36 && (
                        <Text
                          text={`${m.width} × ${m.height} um`}
                          x={0}
                          y={startY + nameFS * 1.3}
                          width={w}
                          align="center"
                          fill="rgba(10, 20, 40, 0.6)"
                          fontSize={subFS}
                          fontFamily="Inter"
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
        </Layer>
      </Stage>
      {mousePos && (
        <div className="coordinate-overlay">
          X: {formatGridValue(mousePos.x, gridSize)} Y: {formatGridValue(mousePos.y, gridSize)}
        </div>
      )}
      {appMode === 'measure' && (
        <div className="coordinate-overlay" style={{ top: 'auto', bottom: '16px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'rgba(234, 179, 8, 0.9)', color: '#0f172a', fontWeight: 'bold' }}>
          Measure Mode | Click two snapped points | Press 'o' to toggle Ortho [ {orthogonalRuler ? 'ON' : 'OFF'} ] | Press 'Esc' to cancel
        </div>
      )}
      {appMode === 'pixel-array' && pendingPixelArraySize && (
        <div className="coordinate-overlay pixel-array-placement-hint">
          Pixel Array {formatGridValue(pendingPixelArraySize.width, gridSize)} × {formatGridValue(pendingPixelArraySize.height, gridSize)} um · Click inside the top cell to place · Esc cancels
        </div>
      )}
      {appMode === 'place' && placementMasterId && masterCells[placementMasterId]?.kind === 'pad' && (
        <div className="coordinate-overlay manual-pad-placement-hint">
          Manual Pad Groups · Auto-rotate by nearest edge · {pendingManualPadGroup?.count ?? 1} pads at {pendingManualPadGroup?.pitch ?? 0} um pitch · Click each group location · Esc finishes
        </div>
      )}
      {showAutoDim && appMode !== 'measure' && !pixelArraySelected && (
        <div className="autodim-legend">
          <span className="autodim-legend__swatch" />
          Nearest visible gaps · select a block to focus its local dimensions
        </div>
      )}
    </div>
  );
};
