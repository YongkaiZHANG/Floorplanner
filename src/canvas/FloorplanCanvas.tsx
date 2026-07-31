import React, { useRef, useState, useEffect } from 'react';
import { Stage, Layer, Rect, Text, Group, Line, Circle } from 'react-konva';
import { useStore, getTransformProps } from '../store/useStore';
import Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import './FloorplanCanvas.css';

const ZOOM_SPEED = 1.1;
export const SCALE_FACTOR = 100; // 1um = 100px on screen

export const FloorplanCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 }); 
  const [stageScale, setStageScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);

  // Measure Mode State
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measureStart, setMeasureStart] = useState<{ x: number; y: number } | null>(null);
  const [currentRuler, setCurrentRuler] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [hoveredRulerId, setHoveredRulerId] = useState<string | null>(null);
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
    setSelectedInstance,
    deleteInstance,
    addRuler,
    deleteRuler,
    clearRulers,
    placementMasterId,
    placementOrientation,
    placeInstance,
    rightSidebarPinned,
    orthogonalRuler,
    showAutoDim,
  } = useStore();

  const fitView = () => {
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
  };

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
  }, []); // Only on mount.

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      const key = e.key.toLowerCase();
      const state = useStore.getState();
      
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
          if (selectedInstanceId) {
            deleteInstance(selectedInstanceId);
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
        case 'escape':
          if (state.appMode === 'place') {
            state.setPlacement(null);
          } else if (appMode === 'measure') {
            setAppMode('select');
            setIsMeasuring(false);
            setCurrentRuler(null);
          } else if (selectedInstanceId) {
            setSelectedInstance(null);
          }
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [appMode, selectedInstanceId, topWidth, topHeight, rightSidebarPinned]);

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
      let bestSnap: { x: number, y: number, dist: number } | null = null;
      const snapRadiusUm = 15 / (SCALE_FACTOR * stageScale); // 15 screen pixels radius
      
      const segments: {a: {x:number, y:number}, b: {x:number, y:number}}[] = [];
      
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
        segments.push({a: topAsicCorners[i], b: topAsicCorners[(i+1)%4]});
      }

      // instances
      for (const inst of instances) {
        const corners = getInstanceCorners(inst);
        if (!corners) continue;
        for (let i=0; i<4; i++) {
          segments.push({a: corners[i], b: corners[(i+1)%4]});
        }
      }

      for (const seg of segments) {
        const closest = getClosestPointOnSegment({x: umX, y: umY}, seg.a, seg.b);
        if (closest.dist < snapRadiusUm) {
          if (!bestSnap || closest.dist < bestSnap.dist) {
            bestSnap = closest;
          }
        }
      }

      if (bestSnap) {
        return { umX: bestSnap.x, umY: bestSnap.y, isSnapped: true };
      }
    }

    umX = Math.round(umX / gridSize) * gridSize;
    umY = Math.round(umY / gridSize) * gridSize;
    return { umX, umY, isSnapped: false };
  };

  const handleMouseDown = () => {
    if (isPanning) return;
  };

  const handleMouseMove = () => {
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    const { umX, umY, isSnapped } = getSnappedWorldPos(pointer, appMode === 'measure');
    
    setMousePos({ x: umX, y: umY });
    
    if (appMode === 'measure' && isSnapped) {
      setSnapIndicator({ x: umX, y: umY });
    } else {
      setSnapIndicator(null);
    }

    if (appMode === 'measure' && isMeasuring && measureStart) {
      let ex = umX;
      let ey = umY;
      
      if (orthogonalRuler) {
        const dx = Math.abs(ex - measureStart.x);
        const dy = Math.abs(ey - measureStart.y);
        if (dx > dy) {
          ey = measureStart.y;
        } else {
          ex = measureStart.x;
        }
      }
      
      setCurrentRuler({ startX: measureStart.x, startY: measureStart.y, endX: ex, endY: ey });
    }
  };

  const handleMouseLeave = () => {
    setMousePos(null);
  };

  const handleMouseUp = () => {
    // We moved ruler finish logic to onClick
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
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const transform = stage.getAbsoluteTransform().copy().invert();
    const worldPos = transform.point(pos);
    const umX = worldPos.x / SCALE_FACTOR;
    const umY = worldPos.y / SCALE_FACTOR;
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
    const dimColor = '#38bdf8'; // sky blue - distinct from rulers (yellow)
    const dimColorAuto = '#a78bfa'; // violet for auto-dim mode
    const annotations: React.ReactNode[] = [];
    const topBox: BBox = { minX: -topWidth/2, maxX: topWidth/2, minY: -topHeight/2, maxY: topHeight/2 };

    const renderDimLine = (x1: number, y1: number, x2: number, y2: number, label: string, color: string, key: string) => {
      const mx = (x1 + x2) / 2 * sf;
      const my = (y1 + y2) / 2 * sf;
      const isVert = Math.abs(x2 - x1) < 0.001;
      const isHoriz = Math.abs(y2 - y1) < 0.001;
      const tickLen = 6 / stageScale;
      const textOffset = 10 / stageScale;
      const fs = 11 / stageScale;

      return (
        <Group key={key} listening={false}>
          {/* Main dim line */}
          <Line
            points={[x1*sf, y1*sf, x2*sf, y2*sf]}
            stroke={color}
            strokeWidth={1 / stageScale}
            dash={[4/stageScale, 3/stageScale]}
          />
          {/* End ticks */}
          {isHoriz && <>
            <Line points={[x1*sf, y1*sf - tickLen, x1*sf, y1*sf + tickLen]} stroke={color} strokeWidth={1/stageScale} />
            <Line points={[x2*sf, y2*sf - tickLen, x2*sf, y2*sf + tickLen]} stroke={color} strokeWidth={1/stageScale} />
          </>}
          {isVert && <>
            <Line points={[x1*sf - tickLen, y1*sf, x1*sf + tickLen, y1*sf]} stroke={color} strokeWidth={1/stageScale} />
            <Line points={[x2*sf - tickLen, y2*sf, x2*sf + tickLen, y2*sf]} stroke={color} strokeWidth={1/stageScale} />
          </>}
          {/* Label */}
          <Text
            x={mx + (isVert ? textOffset : 0)}
            y={my + (isHoriz ? textOffset : 0)}
            text={label}
            fill={color}
            fontSize={fs}
            fontFamily="monospace"
            fontStyle="bold"
            scaleY={-1}
            offsetY={isHoriz ? 0 : fs}
            listening={false}
          />
        </Group>
      );
    };

    const snapLabel = (v: number) => {
      const snapped = Math.round(v / gridSize) * gridSize;
      return parseFloat(snapped.toFixed(4)).toString();
    };

    if (selectedId) {
      const sel = instances.find(i => i.id === selectedId);
      if (sel) {
        const selBox = computeInstanceBBox(sel);
        if (selBox) {
          // Compute gap in each direction: find nearest boundary (other IP or top_asic wall)
          // Right gap: from selBox.maxX toward something
          const others = instances.filter(i => i.id !== selectedId).map(i => ({ id: i.id, box: computeInstanceBBox(i) })).filter(x => x.box !== null) as { id: string; box: BBox }[];

          // Right (positive X)
          let rightGapEnd = topBox.maxX;
          others.forEach(({ box: ob }) => {
            if (ob.minX > selBox.maxX - 0.001 &&
                ob.minY < selBox.maxY && ob.maxY > selBox.minY) {
              if (ob.minX < rightGapEnd) rightGapEnd = ob.minX;
            }
          });
          const rightGap = rightGapEnd - selBox.maxX;
          if (rightGap > gridSize * 0.5) {
            const midY = (selBox.minY + selBox.maxY) / 2;
            annotations.push(renderDimLine(selBox.maxX, midY, rightGapEnd, midY, snapLabel(rightGap), dimColor, 'gap-right'));
          }

          // Left (negative X)
          let leftGapStart = topBox.minX;
          others.forEach(({ box: ob }) => {
            if (ob.maxX < selBox.minX + 0.001 &&
                ob.minY < selBox.maxY && ob.maxY > selBox.minY) {
              if (ob.maxX > leftGapStart) leftGapStart = ob.maxX;
            }
          });
          const leftGap = selBox.minX - leftGapStart;
          if (leftGap > gridSize * 0.5) {
            const midY = (selBox.minY + selBox.maxY) / 2;
            annotations.push(renderDimLine(leftGapStart, midY, selBox.minX, midY, snapLabel(leftGap), dimColor, 'gap-left'));
          }

          // Up (positive Y)
          let topGapEnd = topBox.maxY;
          others.forEach(({ box: ob }) => {
            if (ob.minY > selBox.maxY - 0.001 &&
                ob.minX < selBox.maxX && ob.maxX > selBox.minX) {
              if (ob.minY < topGapEnd) topGapEnd = ob.minY;
            }
          });
          const topGap = topGapEnd - selBox.maxY;
          if (topGap > gridSize * 0.5) {
            const midX = (selBox.minX + selBox.maxX) / 2;
            annotations.push(renderDimLine(midX, selBox.maxY, midX, topGapEnd, snapLabel(topGap), dimColor, 'gap-top'));
          }

          // Down (negative Y)
          let botGapStart = topBox.minY;
          others.forEach(({ box: ob }) => {
            if (ob.maxY < selBox.minY + 0.001 &&
                ob.minX < selBox.maxX && ob.maxX > selBox.minX) {
              if (ob.maxY > botGapStart) botGapStart = ob.maxY;
            }
          });
          const botGap = selBox.minY - botGapStart;
          if (botGap > gridSize * 0.5) {
            const midX = (selBox.minX + selBox.maxX) / 2;
            annotations.push(renderDimLine(midX, botGapStart, midX, selBox.minY, snapLabel(botGap), dimColor, 'gap-bot'));
          }
        }
      }
    }

    if (autoMode) {
      // Auto-Dim: render all pairwise horizontal and vertical gaps between adjacent IPs
      const allBoxes = instances.map(i => ({ id: i.id, box: computeInstanceBBox(i) })).filter(x => x.box !== null) as { id: string; box: BBox }[];
      const seenPairs = new Set<string>();

      allBoxes.forEach(({ id: idA, box: bA }) => {
        // Horizontal: find IPs directly to the right with overlapping Y range
        allBoxes.forEach(({ id: idB, box: bB }) => {
          if (idA === idB) return;
          const pairKey = [idA, idB].sort().join('|');
          if (seenPairs.has(pairKey)) return;

          const yOverlap = Math.min(bA.maxY, bB.maxY) - Math.max(bA.minY, bB.minY);
          const xOverlap = Math.min(bA.maxX, bB.maxX) - Math.max(bA.minX, bB.minX);

          // Horizontal gap (B is directly right of A)
          if (bB.minX >= bA.maxX - 0.001 && yOverlap > 0) {
            const gap = bB.minX - bA.maxX;
            if (gap > gridSize * 0.5) {
              seenPairs.add(pairKey);
              const midY = (Math.max(bA.minY, bB.minY) + Math.min(bA.maxY, bB.maxY)) / 2;
              annotations.push(renderDimLine(bA.maxX, midY, bB.minX, midY, snapLabel(gap), dimColorAuto, `auto-h-${pairKey}`));
            }
          }
          // Vertical gap (B is directly above A)
          else if (bB.minY >= bA.maxY - 0.001 && xOverlap > 0) {
            const gap = bB.minY - bA.maxY;
            if (gap > gridSize * 0.5) {
              seenPairs.add(pairKey);
              const midX = (Math.max(bA.minX, bB.minX) + Math.min(bA.maxX, bB.maxX)) / 2;
              annotations.push(renderDimLine(midX, bA.maxY, midX, bB.minY, snapLabel(gap), dimColorAuto, `auto-v-${pairKey}`));
            }
          }
        });
      });
    }

    return annotations;
  };

  const renderRuler = (r: { id?: string; startX: number, startY: number, endX: number, endY: number }, key: string, onDelete?: () => void) => {
    const sx = r.startX * SCALE_FACTOR;
    const sy = r.startY * SCALE_FACTOR;
    const ex = r.endX * SCALE_FACTOR;
    const ey = r.endY * SCALE_FACTOR;
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
      const endTickLen = 10 / stageScale;
      ticks.push(
        <Line key={`start-tick-${key}`} points={[sx - nx * endTickLen, sy - ny * endTickLen, sx + nx * endTickLen, sy + ny * endTickLen]} stroke={rulerColor} strokeWidth={1.5 / stageScale} />
      );
      ticks.push(
        <Line key={`end-tick-${key}`} points={[ex - nx * endTickLen, ey - ny * endTickLen, ex + nx * endTickLen, ey + ny * endTickLen]} stroke={rulerColor} strokeWidth={1.5 / stageScale} />
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
          fontSize={14 / stageScale}
          fontStyle="bold"
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
          <Line
            points={[sx, sy, ex, ey]}
            stroke="transparent"
            strokeWidth={14 / stageScale}
            hitStrokeWidth={14 / stageScale}
          />
        )}
        {/* Main Line */}
        <Line points={[sx, sy, ex, ey]} stroke={rulerColor} strokeWidth={isHovered ? 2 / stageScale : 1 / stageScale} listening={false} />
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
        draggable={appMode === 'select'}
        onDragStart={() => setIsPanning(true)}
        onDragEnd={() => setIsPanning(false)}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
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
          if (appMode === 'measure') {
            let clickedInstId = null;
            let node = e.target as any;
            while (node && node.parent) {
              if (node.id && typeof node.id === 'function') {
                const id = node.id();
                if (instances.find(i => i.id === id)) {
                  clickedInstId = id;
                  break;
                }
              }
              node = node.parent;
            }

            if (clickedInstId) {
              const inst = instances.find(i => i.id === clickedInstId);
              if (inst) {
                const corners = getInstanceCorners(inst);
                if (corners) {
                  const a = corners[0];
                  const b = corners[1]; // width vector
                  const d = corners[3]; // height vector
                  addRuler(a.x, a.y, b.x, b.y);
                  addRuler(a.x, a.y, d.x, d.y);
                }
              }
            } else if (e.target.name() === 'bg' || e.target === e.target.getStage()) {
              const tw = topWidth;
              const th = topHeight;
              addRuler(-tw/2, -th/2, tw/2, -th/2); // bottom edge width
              addRuler(-tw/2, -th/2, -tw/2, th/2); // left edge height
            }
          }
        }}
        onClick={(e) => {
          const pointer = stageRef.current?.getPointerPosition();
          const snapped = pointer ? getSnappedWorldPos(pointer, appMode === 'measure') : null;
          
          if (appMode === 'measure' && snapped) {
            if (!isMeasuring) {
              setIsMeasuring(true);
              setMeasureStart({ x: snapped.umX, y: snapped.umY });
              setCurrentRuler({ startX: snapped.umX, startY: snapped.umY, endX: snapped.umX, endY: snapped.umY });
            } else if (currentRuler) {
              setIsMeasuring(false);
              if (currentRuler.startX !== currentRuler.endX || currentRuler.startY !== currentRuler.endY) {
                addRuler(currentRuler.startX, currentRuler.startY, currentRuler.endX, currentRuler.endY);
              }
              setCurrentRuler(null);
            }
          } else if (appMode === 'place' && placementMasterId && snapped) {
            placeInstance(placementMasterId, snapped.umX, snapped.umY, placementOrientation);
          } else if (appMode === 'select' && (e.target === e.target.getStage() || e.target.name() === 'bg' || e.target.name() === 'overlay')) {
            setSelectedInstance(null);
          }
        }}
        ref={stageRef}
        style={{ 
          cursor: appMode === 'measure' ? 'crosshair' : (isPanning ? 'grabbing' : 'grab')
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
            const isSelected = selectedInstanceId === inst.id;

            const t = getTransformProps(inst.orientation);

            return (
              <Group
                key={inst.id}
                id={inst.id}
                x={inst.x * SCALE_FACTOR}
                y={inst.y * SCALE_FACTOR}
                rotation={t.rotation}
                scaleX={t.scaleX}
                scaleY={t.scaleY}
                draggable={appMode === 'select'}
                dragBoundFunc={(pos) => dragBoundFunc(pos, inst.cellId, inst.orientation)}
                onDragEnd={(e) => handleDragEnd(e, inst.id)}
                onClick={(e) => {
                  e.cancelBubble = true;
                  if (appMode === 'select') {
                    setSelectedInstance(inst.id);
                  }
                }}
              >
                <Rect
                  width={w}
                  height={h}
                  fill={masterCell.color}
                  opacity={0.5}
                  stroke={isSelected ? '#f8fafc' : '#334155'}
                  strokeWidth={isSelected ? 3 / stageScale : 1 / stageScale}
                />
                
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

          {/* Rulers */}
          {rulers.map(r => renderRuler(r, r.id, () => deleteRuler(r.id)))}
          {isMeasuring && currentRuler && renderRuler(currentRuler, 'temp_ruler')}

          {/* Gap Annotations (selection-based + auto-dim) */}
          {renderGapAnnotations(selectedInstanceId, showAutoDim)}

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
            const t = getTransformProps(placementOrientation);
            return (
              <Group
                x={mousePos.x * SCALE_FACTOR}
                y={mousePos.y * SCALE_FACTOR}
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
          X: {mousePos.x.toFixed(3)} Y: {mousePos.y.toFixed(3)}
        </div>
      )}
      {appMode === 'measure' && (
        <div className="coordinate-overlay" style={{ top: 'auto', bottom: '16px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'rgba(234, 179, 8, 0.9)', color: '#0f172a', fontWeight: 'bold' }}>
          Measure Mode | Double-Click IP to Auto-Dimension | Press 'o' to toggle Ortho [ {orthogonalRuler ? 'ON' : 'OFF'} ] | Press 'Esc' to cancel
        </div>
      )}
    </div>
  );
};
