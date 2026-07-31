import React, { useRef, useState, useEffect } from 'react';
import { Stage, Layer, Rect, Text, Group, Line } from 'react-konva';
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

  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  const { 
    appMode,
    setAppMode,
    topWidth,
    topHeight,
    masterCells, 
    instances,
    rulers,
    gridSize, 
    updateInstancePosition,
    selectedInstanceId,
    setSelectedInstance,
    deleteInstance,
    addRuler,
    clearRulers,
    placementMasterId,
    placementOrientation,
    placeInstance,
    showPropertiesPanel,
    orthogonalRuler
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
            state.setShowPropertiesPanel(!state.showPropertiesPanel);
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
  }, [appMode, selectedInstanceId, topWidth, topHeight, showPropertiesPanel]);

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
      
      for (const inst of instances) {
        const corners = getInstanceCorners(inst);
        if (!corners) continue;
        for (let i=0; i<4; i++) {
          const a = corners[i];
          const b = corners[(i+1)%4];
          const closest = getClosestPointOnSegment({x: umX, y: umY}, a, b);
          if (closest.dist < snapRadiusUm) {
            if (!bestSnap || closest.dist < bestSnap.dist) {
              bestSnap = closest;
            }
          }
        }
      }
      if (bestSnap) {
        return { umX: bestSnap.x, umY: bestSnap.y };
      }
    }

    umX = Math.round(umX / gridSize) * gridSize;
    umY = Math.round(umY / gridSize) * gridSize;
    return { umX, umY };
  };

  const handleMouseDown = () => {
    if (isPanning) return;
  };

  const handleMouseMove = () => {
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    const { umX, umY } = getSnappedWorldPos(pointer, appMode === 'measure');
    
    setMousePos({ x: umX, y: umY });

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
    const node = e.target;
    const umX = node.x() / SCALE_FACTOR;
    const umY = node.y() / SCALE_FACTOR;
    updateInstancePosition(instanceId, umX, umY);
  };

  const renderRuler = (r: { startX: number, startY: number, endX: number, endY: number }, key: string) => {
    const sx = r.startX * SCALE_FACTOR;
    const sy = r.startY * SCALE_FACTOR;
    const ex = r.endX * SCALE_FACTOR;
    const ey = r.endY * SCALE_FACTOR;
    
    const dx = r.endX - r.startX;
    const dy = r.endY - r.startY;
    const dist = Math.sqrt(dx*dx + dy*dy);
    
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
            stroke="#eab308" 
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
            fill="#eab308"
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
        <Line key={`start-tick-${key}`} points={[sx - nx * endTickLen, sy - ny * endTickLen, sx + nx * endTickLen, sy + ny * endTickLen]} stroke="#eab308" strokeWidth={1.5 / stageScale} />
      );
      ticks.push(
        <Line key={`end-tick-${key}`} points={[ex - nx * endTickLen, ey - ny * endTickLen, ex + nx * endTickLen, ey + ny * endTickLen]} stroke="#eab308" strokeWidth={1.5 / stageScale} />
      );

      // Start text (0)
      texts.push(
        <Text
          key={`start-text-${key}`}
          x={sx + nx * 10 / stageScale}
          y={sy + ny * 10 / stageScale}
          text="0"
          fill="#eab308"
          fontSize={12 / stageScale}
          fontFamily="monospace"
          scaleY={-1}
          offsetY={-6 / stageScale}
        />
      );

      // End text (Total length)
      texts.push(
        <Text
          key={`end-text-${key}`}
          x={ex + nx * 10 / stageScale}
          y={ey + ny * 10 / stageScale}
          text={parseFloat((Math.round(dist / gridSize) * gridSize).toFixed(4)).toString()}
          fill="#eab308"
          fontSize={14 / stageScale}
          fontStyle="bold"
          fontFamily="monospace"
          scaleY={-1}
          offsetY={-7 / stageScale}
        />
      );
    }

    return (
      <Group key={key}>
        {/* Main Line */}
        <Line points={[sx, sy, ex, ey]} stroke="#eab308" strokeWidth={1 / stageScale} />
        {/* Ticks and Markers */}
        {ticks}
        {/* Texts */}
        {texts}
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
            text={`top_asic (${topWidth}um x ${topHeight}um)`}
            x={-tw / 2}
            y={th / 2 + 25 / stageScale}
            fill="#475569"
            fontSize={16 / stageScale}
            fontFamily="Inter"
            scaleY={-1}
          />
          {/* Top Right Coordinate */}
          <Text
            text={`(${topWidth/2}, ${topHeight/2})`}
            x={tw / 2 - 60 / stageScale}
            y={th / 2 - 10 / stageScale}
            fill="#475569"
            fontSize={12 / stageScale}
            fontFamily="Inter"
            scaleY={-1}
          />
          {/* Bottom Left Coordinate */}
          <Text
            text={`(${-topWidth/2}, ${-topHeight/2})`}
            x={-tw / 2 + 10 / stageScale}
            y={-th / 2 + 15 / stageScale}
            fill="#475569"
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
                
                {(h * stageScale > 15 && w * stageScale > 30) && (() => {
                  const fontSize = Math.min(w * 0.15, h * 0.25, 40);
                  return (
                    <Group scaleY={-1} offsetY={h}>
                      <Text
                        text={masterCell.cellName}
                        x={0}
                        y={h/2 - fontSize}
                        width={w}
                        align="center"
                        fill="rgba(15, 23, 42, 0.9)"
                        fontSize={fontSize}
                        fontFamily="Inter"
                        fontStyle="bold"
                      />
                      <Text
                        text={`${masterCell.width}x${masterCell.height}`}
                        x={0}
                        y={h/2 + fontSize * 0.2}
                        width={w}
                        align="center"
                        fill="rgba(15, 23, 42, 0.7)"
                        fontSize={fontSize * 0.7}
                        fontFamily="Inter"
                        fontStyle="normal"
                      />
                    </Group>
                  );
                })()}
              </Group>
            );
          })}

          {/* Rulers */}
          {rulers.map(r => renderRuler(r, r.id))}
          {isMeasuring && currentRuler && renderRuler(currentRuler, 'temp_ruler')}

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
                {(m.height * SCALE_FACTOR * stageScale > 15 && m.width * SCALE_FACTOR * stageScale > 30) && (() => {
                  const w = m.width * SCALE_FACTOR;
                  const h = m.height * SCALE_FACTOR;
                  const fontSize = Math.min(w * 0.15, h * 0.25, 40);
                  return (
                    <Group scaleY={-1} offsetY={h}>
                      <Text
                        text={`(New) ${m.cellName}`}
                        x={0}
                        y={h/2 - fontSize}
                        width={w}
                        align="center"
                        fill="rgba(15, 23, 42, 0.9)"
                        fontSize={fontSize}
                        fontFamily="Inter"
                        fontStyle="bold"
                      />
                      <Text
                        text={`${m.width}x${m.height}`}
                        x={0}
                        y={h/2 + fontSize * 0.2}
                        width={w}
                        align="center"
                        fill="rgba(15, 23, 42, 0.7)"
                        fontSize={fontSize * 0.7}
                        fontFamily="Inter"
                        fontStyle="normal"
                      />
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
