import { useStore } from '../store/useStore';
import { SCALE_FACTOR } from '../canvas/FloorplanCanvas';

export const exportSVG = () => {
  const state = useStore.getState();
  const sf = SCALE_FACTOR;
  const tw = state.topWidth * sf;
  const th = state.topHeight * sf;
  
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
  });
  
  const pad = 100;
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  
  const vbW = maxX - minX;
  const vbH = maxY - minY;
  
  const stateData = {
    gridSize: state.gridSize,
    topWidth: state.topWidth,
    topHeight: state.topHeight,
    masterCells: state.masterCells,
    instances: state.instances,
    rulers: state.rulers,
  };

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${-maxY} ${vbW} ${vbH}">\n`;
  svg += `<metadata class="floorplan-data">\n`;
  svg += `<![CDATA[${JSON.stringify(stateData)}]]>\n`;
  svg += `</metadata>\n`;
  svg += `<g transform="scale(1, -1)">\n`;
  
  // Top ASIC
  svg += `  <rect x="${-tw/2}" y="${-th/2}" width="${tw}" height="${th}" fill="#ffffff" stroke="#475569" stroke-width="2" stroke-dasharray="10,10" />\n`;
  
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
    
    const transform = `translate(${x} ${y}) rotate(${rot}) scale(${scaleX} ${scaleY})`;
    svg += `  <g transform="${transform}">\n`;
    svg += `    <rect width="${w}" height="${h}" fill="${m.color}" fill-opacity="0.5" stroke="#334155" stroke-width="1" />\n`;
    
    const fontSize = Math.min(w * 0.15, h * 0.25, 40);
    svg += `    <text x="${w/2}" y="${h/2 - fontSize*0.6}" fill="rgba(15, 23, 42, 0.9)" font-family="Inter, sans-serif" font-weight="bold" font-size="${fontSize}" text-anchor="middle" dominant-baseline="middle" transform="scale(1, -1) translate(0, ${-h})">${m.cellName}</text>\n`;
    svg += `    <text x="${w/2}" y="${h/2 + fontSize*0.6}" fill="rgba(15, 23, 42, 0.7)" font-family="Inter, sans-serif" font-weight="normal" font-size="${fontSize * 0.7}" text-anchor="middle" dominant-baseline="middle" transform="scale(1, -1) translate(0, ${-h})">${m.width}x${m.height}</text>\n`;
    svg += `  </g>\n`;
  });
  
  // Rulers
  state.rulers.forEach((r) => {
    const sx = r.startX * sf;
    const sy = r.startY * sf;
    const ex = r.endX * sf;
    const ey = r.endY * sf;
    
    svg += `  <line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="#eab308" stroke-width="1" />\n`;
    
    const dx = ex - sx;
    const dy = ey - sy;
    const dist = Math.hypot(dx, dy);
    if(dist > 0) {
      const ux = dx/dist, uy = dy/dist;
      const nx = -uy, ny = ux;
      const tickLen = 10;
      
      svg += `  <line x1="${sx - nx*tickLen}" y1="${sy - ny*tickLen}" x2="${sx + nx*tickLen}" y2="${sy + ny*tickLen}" stroke="#eab308" stroke-width="1.5" />\n`;
      svg += `  <line x1="${ex - nx*tickLen}" y1="${ey - ny*tickLen}" x2="${ex + nx*tickLen}" y2="${ey + ny*tickLen}" stroke="#eab308" stroke-width="1.5" />\n`;
      
      svg += `  <text x="${sx + nx*15}" y="${- (sy + ny*15)}" fill="#eab308" font-family="monospace" font-size="12" dominant-baseline="middle">0</text>\n`;
      svg += `  <text x="${ex + nx*15}" y="${- (ey + ny*15)}" fill="#eab308" font-family="monospace" font-size="14" font-weight="bold" dominant-baseline="middle">${parseFloat((Math.round(dist/sf/state.gridSize)*state.gridSize).toFixed(4))}</text>\n`;
    }
  });
  
  svg += `</g>\n</svg>`;
  
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'floorplan.svg';
  a.click();
  URL.revokeObjectURL(url);
};
