import { useStore } from '../store/useStore';
import { SCALE_FACTOR } from '../canvas/FloorplanCanvas';
import { formatGridValue } from './grid';

export const exportSVG = () => {
  const state = useStore.getState();
  const sf = SCALE_FACTOR;
  const tw = state.topWidth * sf;
  const th = state.topHeight * sf;
  
  // Base font size for readability
  const baseFS = Math.max(tw, th) * 0.015;
  const smallFS = baseFS * 0.7;
  const largeFS = baseFS * 1.5;

  let minX = -tw/2;
  let maxX = tw/2;
  let minY = -th/2;
  let maxY = th/2;
  
  const updateBounds = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  
  state.rulers.forEach((r) => {
    updateBounds(r.startX * sf, r.startY * sf);
    updateBounds(r.endX * sf, r.endY * sf);
    if (r.referenceX !== undefined && r.referenceY !== undefined) {
      updateBounds(r.referenceX * sf, r.referenceY * sf);
    }
  });
  
  state.instances.forEach((inst) => {
    const m = state.masterCells[inst.cellId];
    if (m) {
       const radius = Math.max(m.width, m.height) * sf;
       updateBounds(inst.x * sf - radius, inst.y * sf - radius);
       updateBounds(inst.x * sf + radius, inst.y * sf + radius);
    }
  });

  // SVG Data Table computation
  const tableStartY = minY - baseFS * 4;
  const rowHeight = baseFS * 2;
  const tableRows = state.instances.length + 3; // + header + topcell + spacing
  const tableHeight = tableRows * rowHeight;
  
  // Ensure the bounding box includes the table
  updateBounds(minX, tableStartY - tableHeight - rowHeight);
  updateBounds(minX + tw, tableStartY - tableHeight - rowHeight);
  
  const pad = Math.max(tw * 0.1, th * 0.1, baseFS * 5);
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  
  const vbW = maxX - minX;
  const vbH = maxY - minY;
  
  // Embed full project state as metadata so it can be re-imported
  const stateData = {
    gridSize: state.gridSize,
    topWidth: state.topWidth,
    topHeight: state.topHeight,
    topLibName: state.topLibName,
    topCellName: state.topCellName,
    masterCells: state.masterCells,
    instances: state.instances,
    rulers: state.rulers,
    pixelArray: state.pixelArray,
  };

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${-maxY} ${vbW} ${vbH}" style="background-color: #f8fafc;">\n`;
  svg += `<metadata class="floorplan-data">\n`;
  svg += `<![CDATA[${JSON.stringify(stateData)}]]>\n`;
  svg += `</metadata>\n`;
  svg += `<g transform="scale(1, -1)">\n`;
  
  // Top ASIC Boundary
  svg += `  <rect x="${-tw/2}" y="${-th/2}" width="${tw}" height="${th}" fill="#ffffff" stroke="#334155" stroke-width="3" stroke-dasharray="20,10" vector-effect="non-scaling-stroke" />\n`;

  if (state.pixelArray?.visible) {
    const array = state.pixelArray;
    const x = array.x * sf;
    const y = array.y * sf;
    const width = array.width * sf;
    const height = array.height * sf;
    svg += `  <g>\n`;
    svg += `    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#8b5cf6" fill-opacity="0.1" stroke="#7c3aed" stroke-width="2" stroke-dasharray="8,6" vector-effect="non-scaling-stroke" />\n`;
    for (let index = 1; index < 6; index += 1) {
      const gx = x + width * index / 6;
      const gy = y + height * index / 6;
      svg += `    <line x1="${gx}" y1="${y}" x2="${gx}" y2="${y + height}" stroke="#8b5cf6" stroke-width="0.75" opacity="0.3" vector-effect="non-scaling-stroke" />\n`;
      svg += `    <line x1="${x}" y1="${gy}" x2="${x + width}" y2="${gy}" stroke="#8b5cf6" stroke-width="0.75" opacity="0.3" vector-effect="non-scaling-stroke" />\n`;
    }
    svg += `    <text x="${x + width / 2}" y="${-(y + height / 2)}" fill="#6d28d9" font-family="Inter, sans-serif" font-size="${baseFS}" font-weight="700" text-anchor="middle" dominant-baseline="middle" transform="scale(1, -1)">PIXEL ARRAY · ${formatGridValue(array.width, state.gridSize)} × ${formatGridValue(array.height, state.gridSize)} um</text>\n`;
    svg += `  </g>\n`;
  }
  
  // Top ASIC Labels
  const labelY = -(th/2 + baseFS*1.5);
  const blY = -(-th/2 - baseFS);
  
  svg += `  <text x="${-tw/2}" y="${labelY}" fill="#0f172a" font-family="Inter, sans-serif" font-size="${largeFS}" font-weight="700" dominant-baseline="auto" transform="scale(1, -1)">${state.topCellName}  ${state.topWidth}um × ${state.topHeight}um</text>\n`;
  svg += `  <text x="${tw/2}" y="${labelY}" fill="#64748b" font-family="Inter, sans-serif" font-size="${baseFS}" dominant-baseline="auto" text-anchor="end" transform="scale(1, -1)">TR: (${state.topWidth/2}, ${state.topHeight/2})</text>\n`;
  svg += `  <text x="${-tw/2}" y="${blY}" fill="#64748b" font-family="Inter, sans-serif" font-size="${baseFS}" dominant-baseline="hanging" transform="scale(1, -1)">BL: (${-state.topWidth/2}, ${-state.topHeight/2})</text>\n`;


  // Instances
  const sortedInstances = [...state.instances].sort((a, b) => {
    const mA = state.masterCells[a.cellId];
    const mB = state.masterCells[b.cellId];
    if (!mA || !mB) return 0;
    return (mB.width * mB.height) - (mA.width * mA.height);
  });
  
  sortedInstances.forEach((inst) => {
    const m = state.masterCells[inst.cellId];
    if (!m) return;
    
    let rot = 0, scaleX = 1, scaleY = 1;
    switch(inst.orientation) {
      case 'R90': rot = 90; break;
      case 'R180': rot = 180; break;
      case 'R270': rot = 270; break;
      case 'MX': scaleY = -1; break;
      case 'MY': scaleX = -1; break;
      case 'MXR90': scaleY = -1; rot = 90; break;
      case 'MYR90': scaleX = -1; rot = 90; break;
    }
    
    const w = m.width * sf;
    const h = m.height * sf;
    const x = inst.x * sf;
    const y = inst.y * sf;
    const outlineStyle = m.outlineStyle ?? 'solid';
    const outlineStroke = outlineStyle === 'none' ? 'none' : '#1e293b';
    const outlineDash = outlineStyle === 'dashed' ? ' stroke-dasharray="8,6"'
      : outlineStyle === 'dotted' ? ' stroke-dasharray="2,4"' : '';
    
    const transform = `translate(${x} ${y}) rotate(${rot}) scale(${scaleX} ${scaleY})`;
    svg += `  <g transform="${transform}">\n`;
    svg += `    <rect width="${w}" height="${h}" fill="${m.color}" fill-opacity="${m.opacity ?? 0.5}" stroke="${outlineStroke}" stroke-width="1.5"${outlineDash} vector-effect="non-scaling-stroke" />\n`;
    
    const instFS = Math.min(w * 0.15, h * 0.25, baseFS * 2);
    svg += `    <text x="${w/2}" y="${h/2 - instFS*0.6}" fill="#0f172a" font-family="Inter, sans-serif" font-weight="bold" font-size="${instFS}" text-anchor="middle" dominant-baseline="middle" transform="scale(1, -1) translate(0, ${-h})">${m.cellName}</text>\n`;
    svg += `    <text x="${w/2}" y="${h/2 + instFS*0.6}" fill="#334155" font-family="Inter, sans-serif" font-weight="normal" font-size="${instFS * 0.7}" text-anchor="middle" dominant-baseline="middle" transform="scale(1, -1) translate(0, ${-h})">${m.width}x${m.height}</text>\n`;
    svg += `  </g>\n`;
  });
  
  // Rulers
  state.rulers.forEach((r) => {
    const sx = r.startX * sf;
    const sy = r.startY * sf;
    const ex = r.endX * sf;
    const ey = r.endY * sf;
    const referenceX = r.referenceX !== undefined ? r.referenceX * sf : null;
    const referenceY = r.referenceY !== undefined ? r.referenceY * sf : null;
    
    svg += `  <line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="#b45309" stroke-width="2" vector-effect="non-scaling-stroke" />\n`;
    if (referenceX !== null && referenceY !== null && (referenceX !== ex || referenceY !== ey)) {
      svg += `  <line x1="${ex}" y1="${ey}" x2="${referenceX}" y2="${referenceY}" stroke="#b45309" stroke-width="2" opacity="0.8" vector-effect="non-scaling-stroke" />\n`;
      svg += `  <circle cx="${referenceX}" cy="${referenceY}" r="4" fill="#b45309" stroke="#ffffff" stroke-width="1.5" vector-effect="non-scaling-stroke" />\n`;
    }
    
    const dx = ex - sx;
    const dy = ey - sy;
    const dist = Math.hypot(dx, dy);
    
    if(dist > 0) {
      const ux = dx/dist, uy = dy/dist;
      const nx = -uy, ny = ux;
      const tickLen = baseFS * 0.5;
      
      svg += `  <line x1="${sx - nx*tickLen}" y1="${sy - ny*tickLen}" x2="${sx + nx*tickLen}" y2="${sy + ny*tickLen}" stroke="#b45309" stroke-width="2" vector-effect="non-scaling-stroke" />\n`;
      svg += `  <line x1="${ex - nx*tickLen}" y1="${ey - ny*tickLen}" x2="${ex + nx*tickLen}" y2="${ey + ny*tickLen}" stroke="#b45309" stroke-width="2" vector-effect="non-scaling-stroke" />\n`;
      
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      const finalDist = parseFloat((Math.round(dist/sf/state.gridSize)*state.gridSize).toFixed(4)).toString();
      
      let endTextString = `L: ${finalDist}`;
      if (absDx > 0.0001 && absDy > 0.0001) {
        const finalDx = parseFloat((Math.round(absDx/sf/state.gridSize)*state.gridSize).toFixed(4)).toString();
        const finalDy = parseFloat((Math.round(absDy/sf/state.gridSize)*state.gridSize).toFixed(4)).toString();
        endTextString += ` | dX: ${finalDx} | dY: ${finalDy}`;
        
        svg += `  <line x1="${sx}" y1="${sy}" x2="${ex}" y2="${sy}" stroke="#b45309" stroke-width="1.5" stroke-dasharray="8,8" opacity="0.8" vector-effect="non-scaling-stroke" />\n`;
        svg += `  <line x1="${ex}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="#b45309" stroke-width="1.5" stroke-dasharray="8,8" opacity="0.8" vector-effect="non-scaling-stroke" />\n`;
      }
      
      svg += `  <text x="${sx + nx*baseFS}" y="${- (sy + ny*baseFS)}" fill="#b45309" font-family="monospace" font-size="${smallFS}" dominant-baseline="middle" transform="scale(1, -1)">0</text>\n`;
      svg += `  <text x="${ex + nx*baseFS}" y="${- (ey + ny*baseFS)}" fill="#92400e" font-family="monospace" font-size="${baseFS}" font-weight="bold" dominant-baseline="middle" transform="scale(1, -1)">${endTextString}</text>\n`;
    }
  });

  // ==========================================
  // Draw Data Table
  // ==========================================
  let curY = tableStartY;
  const colW = [tw * 0.2, tw * 0.2, tw * 0.15, tw * 0.15, tw * 0.15, tw * 0.15];
  let cx = -tw/2;

  // Title
  svg += `  <text x="${cx}" y="${-curY}" fill="#0f172a" font-family="Inter, sans-serif" font-size="${largeFS}" font-weight="bold" dominant-baseline="auto" transform="scale(1, -1)">Floorplan Data Summary</text>\n`;
  curY -= rowHeight * 1.5;

  // Header Background
  svg += `  <rect x="${-tw/2}" y="${curY - rowHeight}" width="${tw}" height="${rowHeight}" fill="#1e293b" />\n`;
  
  const headers = ["Instance Name", "Master Cell", "X (um)", "Y (um)", "Orientation", "Size (um)"];
  cx = -tw/2;
  headers.forEach((h, i) => {
    svg += `  <text x="${cx + baseFS}" y="${-(curY - rowHeight/2)}" fill="#f8fafc" font-family="Inter, sans-serif" font-size="${baseFS}" font-weight="bold" dominant-baseline="middle" transform="scale(1, -1)">${h}</text>\n`;
    cx += colW[i];
  });
  curY -= rowHeight;

  // Rows
  sortedInstances.forEach((inst, idx) => {
    const m = state.masterCells[inst.cellId];
    if (!m) return;
    
    const bgColor = idx % 2 === 0 ? "#f1f5f9" : "#e2e8f0";
    svg += `  <rect x="${-tw/2}" y="${curY - rowHeight}" width="${tw}" height="${rowHeight}" fill="${bgColor}" />\n`;
    
    cx = -tw/2;
    const rowData = [
      inst.name,
      m.cellName,
      formatGridValue(inst.x, state.gridSize),
      formatGridValue(inst.y, state.gridSize),
      inst.orientation,
      `${m.width} x ${m.height}`
    ];
    
    rowData.forEach((d, i) => {
      svg += `  <text x="${cx + baseFS}" y="${-(curY - rowHeight/2)}" fill="#0f172a" font-family="monospace" font-size="${baseFS}" dominant-baseline="middle" transform="scale(1, -1)">${d}</text>\n`;
      cx += colW[i];
    });
    
    curY -= rowHeight;
  });
  
  // Table border
  const totalTableHeight = tableStartY - 1.5*rowHeight - curY;
  svg += `  <rect x="${-tw/2}" y="${curY}" width="${tw}" height="${totalTableHeight}" fill="none" stroke="#334155" stroke-width="2" vector-effect="non-scaling-stroke" />\n`;

  svg += `</g>\n</svg>`;
  
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const filename = `${state.topCellName}_floorplan.svg`;
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
};
