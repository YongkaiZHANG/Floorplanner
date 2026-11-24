import type { ProjectSnapshot } from '../store/projectDocument.ts';
import { getProjectSnapshot, useStore } from '../store/useStore.ts';
import { getPhysicalBounds, isActiveMosaic } from './alignment.ts';
import { SCALE_FACTOR } from './canvasConstants.ts';
import { formatGridValue } from './grid.ts';
import { resolveLayerStyle, resolveTextFontFamilyCss } from './layoutLayers.ts';
import type { LayoutShape } from './layoutLayers.ts';

const escapeXml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const escapeCdata = (value: string): string => value.replace(/]]>/g, ']]]]><![CDATA[>');

/** Extract the JSON payload stored inside `<metadata class="floorplan-data">`. */
export const extractProjectFromSvg = (text: string): string | null => {
  const metadataMatch = text.match(/<metadata\b[^>]*class=["']floorplan-data["'][^>]*>([\s\S]*?)<\/metadata>/);
  if (!metadataMatch) return null;
  const inner = metadataMatch[1];
  const cdataChunks = [...inner.matchAll(/<!\[CDATA\[([\s\S]*?)]]>/g)].map(match => match[1]);
  if (cdataChunks.length > 0) return cdataChunks.join('');
  const trimmed = inner.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const generateSvgMarkup = (state: ProjectSnapshot): string => {
  const sf = SCALE_FACTOR;
  const tw = state.topWidth * sf;
  const th = state.topHeight * sf;
  
  // Base font size for readability
  const baseFS = Math.max(tw, th) * 0.015;
  const smallFS = baseFS * 0.7;
  const largeFS = baseFS * 1.5;

  let minX = -tw / 2;
  let maxX = tw / 2;
  let minY = -th / 2;
  let maxY = th / 2;
  
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
    if (m && m.width > 0 && m.height > 0) {
      const bounds = getPhysicalBounds({
        ...inst,
        width: m.width,
        height: m.height,
        originX: m.originX,
        originY: m.originY,
      });
      updateBounds(bounds.left * sf, bounds.bottom * sf);
      updateBounds(bounds.right * sf, bounds.top * sf);
    }
  });

  (state.shapes ?? []).forEach((shape) => {
    updateBounds(shape.x * sf, shape.y * sf);
    updateBounds((shape.x + shape.width) * sf, (shape.y + shape.height) * sf);
  });

  // SVG Data Table computation
  const tableStartY = minY - baseFS * 4;
  const rowHeight = baseFS * 2;
  const tableRows = state.instances.length + 3; // + header + topcell + spacing
  const tableHeight = tableRows * rowHeight;
  
  // Ensure the bounding box includes the table
  updateBounds(-tw / 2, tableStartY - tableHeight - rowHeight);
  updateBounds(tw / 2, tableStartY - tableHeight - rowHeight);
  
  const pad = Math.max(tw * 0.1, th * 0.1, baseFS * 5);
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  
  const vbW = maxX - minX;
  const vbH = maxY - minY;
  
  // Embed full project state as metadata so it can be re-imported
  const stateData: ProjectSnapshot = {
    gridSize: state.gridSize,
    topWidth: state.topWidth,
    topHeight: state.topHeight,
    topLibName: state.topLibName,
    topCellName: state.topCellName,
    masterCells: state.masterCells,
    instances: state.instances,
    rulers: state.rulers,
    ...(state.shapes && state.shapes.length > 0 ? { shapes: state.shapes } : {}),
    pixelArray: state.pixelArray ?? null,
    ...(state.padInset !== undefined && state.padInset > 0 ? { padInset: state.padInset } : {}),
    ...(state.libraries && state.libraries.length > 0 ? { libraries: state.libraries } : {}),
    ...(state.cellViews && Object.keys(state.cellViews).length > 0 ? { cellViews: state.cellViews } : {}),
  };

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${-maxY} ${vbW} ${vbH}" style="background-color: #f8fafc;">\n`;
  svg += `<metadata class="floorplan-data">\n`;
  svg += `<![CDATA[${escapeCdata(JSON.stringify(stateData))}]]>\n`;
  svg += `</metadata>\n`;
  svg += `<g transform="scale(1, -1)">\n`;
  
  // Top ASIC Boundary
  svg += `  <rect x="${-tw / 2}" y="${-th / 2}" width="${tw}" height="${th}" fill="#ffffff" stroke="#334155" stroke-width="3" stroke-dasharray="20,10" vector-effect="non-scaling-stroke" />\n`;

  if (state.padInset && state.padInset > 0) {
    const insetPx = state.padInset * sf;
    svg += `  <rect x="${-tw / 2 + insetPx}" y="${-th / 2 + insetPx}" width="${tw - insetPx * 2}" height="${th - insetPx * 2}" fill="none" stroke="#d97706" stroke-width="1.5" stroke-dasharray="6,6" opacity="0.6" vector-effect="non-scaling-stroke" />\n`;
  }

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
    svg += `    <text x="${x + width / 2}" y="${-(y + height / 2)}" fill="#6d28d9" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Inter, sans-serif" font-size="${baseFS}" font-weight="700" text-anchor="middle" dominant-baseline="middle" transform="scale(1, -1)">PIXEL ARRAY · ${formatGridValue(array.width, state.gridSize)} × ${formatGridValue(array.height, state.gridSize)} um</text>\n`;
    svg += `  </g>\n`;
  }
  
  // Top ASIC Labels
  const labelY = -(th / 2 + baseFS * 1.5);
  const blY = -(-th / 2 - baseFS);
  
  svg += `  <text x="${-tw / 2}" y="${labelY}" fill="#0f172a" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Inter, sans-serif" font-size="${largeFS}" font-weight="700" dominant-baseline="auto" transform="scale(1, -1)">${escapeXml(state.topCellName)}  ${state.topWidth}um × ${state.topHeight}um</text>\n`;
  svg += `  <text x="${tw / 2}" y="${labelY}" fill="#64748b" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Inter, sans-serif" font-size="${baseFS}" dominant-baseline="auto" text-anchor="end" transform="scale(1, -1)">TR: (${state.topWidth / 2}, ${state.topHeight / 2})</text>\n`;
  svg += `  <text x="${-tw / 2}" y="${blY}" fill="#64748b" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Inter, sans-serif" font-size="${baseFS}" dominant-baseline="hanging" transform="scale(1, -1)">BL: (${-state.topWidth / 2}, ${-state.topHeight / 2})</text>\n`;

  // Instances
  const sortedInstances = [...state.instances].sort((a, b) => {
    const mA = state.masterCells[a.cellId];
    const mB = state.masterCells[b.cellId];
    if (!mA || !mB) return 0;
    const bA = mA.width > 0 && mA.height > 0 ? getPhysicalBounds({ ...a, width: mA.width, height: mA.height, originX: mA.originX, originY: mA.originY }) : null;
    const bB = mB.width > 0 && mB.height > 0 ? getPhysicalBounds({ ...b, width: mB.width, height: mB.height, originX: mB.originX, originY: mB.originY }) : null;
    const areaA = bA ? bA.width * bA.height : 0;
    const areaB = bB ? bB.width * bB.height : 0;
    return areaB - areaA;
  });
  
  sortedInstances.forEach((inst) => {
    const m = state.masterCells[inst.cellId];
    if (!m) return;
    
    let rot = 0;
    let scaleX = 1;
    let scaleY = 1;
    switch (inst.orientation) {
      case 'R90': rot = 90; break;
      case 'R180': rot = 180; break;
      case 'R270': rot = 270; break;
      case 'MX': scaleY = -1; break;
      case 'MY': scaleX = -1; break;
      case 'MXR90': scaleY = -1; rot = 90; break;
      case 'MYR90': scaleX = -1; rot = 90; break;
    }
    
    const ox = (m.originX ?? 0) * sf;
    const oy = (m.originY ?? 0) * sf;
    const w = m.width * sf;
    const h = m.height * sf;
    const x = inst.x * sf;
    const y = inst.y * sf;
    const childView = state.cellViews?.[inst.cellId];
    const childShapes = childView?.shapes ?? [];
    const childSubInstances = childView?.instances ?? [];
    const childHasContent = childShapes.length > 0 || childSubInstances.length > 0;
    const outlineStyle = m.outlineStyle ?? 'solid';
    const outlineStroke = outlineStyle === 'none' ? 'none' : '#1e293b';
    const outlineDash = outlineStyle === 'dashed' ? ' stroke-dasharray="8,6"'
      : outlineStyle === 'dotted' ? ' stroke-dasharray="2,4"' : '';
    const fillOpacity = m.opacity ?? 0.5;
    const mosaic = isActiveMosaic(inst.mosaic) ? inst.mosaic : null;
    const mosaicRows = mosaic ? mosaic.rows : 1;
    const mosaicCols = mosaic ? mosaic.cols : 1;
    const totalTiles = mosaicRows * mosaicCols;
    const lodPerimeterOnly = totalTiles > 400;

    const renderSingleTileMarkup = (indent: string, includeCenterLabel: boolean): string => {
      let tile = '';
      if (!childHasContent) {
        tile += `${indent}<rect x="${ox}" y="${oy}" width="${w}" height="${h}" fill="${escapeXml(m.color)}" fill-opacity="${fillOpacity}" stroke="${outlineStroke}" stroke-width="1.5"${outlineDash} vector-effect="non-scaling-stroke" />\n`;
      }
      if (childShapes.length > 0) {
        const shapeOffsetX = childView?.coordinateMode === 'centered' ? w / 2 : 0;
        const shapeOffsetY = childView?.coordinateMode === 'centered' ? h / 2 : 0;
        childShapes.forEach(shape => {
          if (shape.kind === 'text') {
            const style = resolveLayerStyle(shape.layer, shape.purpose, shape.color);
            const sx = shape.x * sf + shapeOffsetX;
            const sy = shape.y * sf + shapeOffsetY;
            const fontPx = (shape.fontSize ?? shape.height) * sf;
            const textContent = (shape.label ?? '').trim();
            if (!textContent) return;
            const fontWeight = shape.fontStyle?.includes('bold') ? 'bold' : 'normal';
            const fontStyleAttr = shape.fontStyle?.includes('italic') ? ' font-style="italic"' : '';
            const fontFamily = escapeXml(resolveTextFontFamilyCss(shape.fontFamily));
            tile += `${indent}<g transform="translate(${sx} ${sy})"><text x="0" y="${-fontPx * 0.15}" fill="${escapeXml(style.color)}" font-family="${fontFamily}" font-size="${fontPx}" font-weight="${fontWeight}"${fontStyleAttr} dominant-baseline="alphabetic" transform="scale(1, -1)">${escapeXml(textContent)}</text></g>\n`;
            return;
          }
          const style = resolveLayerStyle(shape.layer, shape.purpose, shape.color);
          const sx = shape.x * sf + shapeOffsetX;
          const sy = shape.y * sf + shapeOffsetY;
          const sw = shape.width * sf;
          const sh = shape.height * sf;
          const dashAttr = style.strokeDash === 'dashed' ? ' stroke-dasharray="6,4"' : '';
          tile += `${indent}<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="${escapeXml(style.color)}" fill-opacity="${style.fillOpacity}" stroke="${escapeXml(style.color)}" stroke-width="1.25"${dashAttr} vector-effect="non-scaling-stroke" />\n`;
          if (shape.label?.trim() && includeCenterLabel) {
            const shapeFS = Math.min(sw * 0.14, sh * 0.24, baseFS * 1.1);
            tile += `${indent}<text x="${sx + sw / 2}" y="${-(sy + sh / 2)}" fill="${escapeXml(style.color)}" font-family="monospace" font-size="${shapeFS}" font-weight="600" text-anchor="middle" dominant-baseline="middle" transform="scale(1, -1)">${escapeXml(shape.label.trim())}</text>\n`;
          }
        });
      }
      if (childSubInstances.length > 0) {
        const subOffsetX = childView?.coordinateMode === 'centered' ? w / 2 : 0;
        const subOffsetY = childView?.coordinateMode === 'centered' ? h / 2 : 0;
        childSubInstances.forEach(sub => {
          const sm = state.masterCells[sub.cellId];
          if (!sm) return;
          const subView = state.cellViews?.[sub.cellId];
          const subShapes = subView?.shapes ?? [];
          if (subShapes.length > 0) {
            subShapes.forEach(shape => {
              const style = resolveLayerStyle(shape.layer, shape.purpose, shape.color);
              const sx = (sub.x + shape.x) * sf + subOffsetX;
              const sy = (sub.y + shape.y) * sf + subOffsetY;
              const dashAttr = style.strokeDash === 'dashed' ? ' stroke-dasharray="6,4"' : '';
              tile += `${indent}<rect x="${sx}" y="${sy}" width="${shape.width * sf}" height="${shape.height * sf}" fill="${escapeXml(style.color)}" fill-opacity="${style.fillOpacity}" stroke="${escapeXml(style.color)}" stroke-width="1"${dashAttr} vector-effect="non-scaling-stroke" />\n`;
            });
            return;
          }
          const smOx = (sm.originX ?? 0) * sf;
          const smOy = (sm.originY ?? 0) * sf;
          tile += `${indent}<rect x="${sub.x * sf + subOffsetX + smOx}" y="${sub.y * sf + subOffsetY + smOy}" width="${sm.width * sf}" height="${sm.height * sf}" fill="${escapeXml(sm.color)}" fill-opacity="0.35" stroke="#1e293b" stroke-width="1" vector-effect="non-scaling-stroke" />\n`;
        });
      }
      if (!childHasContent && includeCenterLabel) {
        const instFS = Math.min(w * 0.15, h * 0.25, baseFS * 2);
        const labelCX = ox + w / 2;
        const labelCY = oy + h / 2;
        tile += `${indent}<text x="${labelCX}" y="${-labelCY - instFS * 0.6}" fill="#0f172a" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Inter, sans-serif" font-weight="bold" font-size="${instFS}" text-anchor="middle" dominant-baseline="middle" transform="scale(1, -1)">${escapeXml(m.cellName)}</text>\n`;
        tile += `${indent}<text x="${labelCX}" y="${-labelCY + instFS * 0.6}" fill="#334155" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Inter, sans-serif" font-weight="normal" font-size="${instFS * 0.7}" text-anchor="middle" dominant-baseline="middle" transform="scale(1, -1)">${m.width}x${m.height}</text>\n`;
      }
      return tile;
    };
    
    const transform = `translate(${x} ${y}) rotate(${rot}) scale(${scaleX} ${scaleY})`;
    svg += `  <g transform="${transform}">\n`;
    if (mosaic) {
      const colSpan = (mosaicCols - 1) * mosaic.colPitch * sf;
      const rowSpan = (mosaicRows - 1) * mosaic.rowPitch * sf;
      const minLocalX = ox + Math.min(0, colSpan);
      const minLocalY = oy + Math.min(0, rowSpan);
      const totalLocalW = w + Math.abs(colSpan);
      const totalLocalH = h + Math.abs(rowSpan);
      if (lodPerimeterOnly) {
        svg += `    <rect x="${minLocalX}" y="${minLocalY}" width="${totalLocalW}" height="${totalLocalH}" fill="${escapeXml(m.color)}" fill-opacity="${Math.min(0.25, fillOpacity)}" stroke="#1e293b" stroke-width="1.25" stroke-dasharray="6,4" vector-effect="non-scaling-stroke" />\n`;
      }
      for (let r = 0; r < mosaicRows; r += 1) {
        for (let c = 0; c < mosaicCols; c += 1) {
          if (lodPerimeterOnly && r > 0 && r < mosaicRows - 1 && c > 0 && c < mosaicCols - 1) continue;
          const tx = c * mosaic.colPitch * sf;
          const ty = r * mosaic.rowPitch * sf;
          svg += `    <g transform="translate(${tx} ${ty})">\n`;
          svg += renderSingleTileMarkup('      ', totalTiles <= 36);
          svg += `    </g>\n`;
        }
      }
      const badgeFS = Math.min(totalLocalW * 0.1, totalLocalH * 0.16, baseFS * 1.4);
      svg += `    <text x="${minLocalX + totalLocalW / 2}" y="${-(minLocalY + totalLocalH / 2)}" fill="#0f172a" font-family="monospace" font-weight="700" font-size="${badgeFS}" text-anchor="middle" dominant-baseline="middle" transform="scale(1, -1)">${escapeXml(m.cellName)} [${mosaicRows}×${mosaicCols}]</text>\n`;
    } else {
      svg += renderSingleTileMarkup('    ', true);
    }
    svg += `  </g>\n`;
  });

  const renderSvgTextShape = (shape: LayoutShape, offsetX = 0, offsetY = 0, indent = '  ') => {
    const style = resolveLayerStyle(shape.layer, shape.purpose, shape.color);
    const sx = shape.x * sf + offsetX;
    const sy = shape.y * sf + offsetY;
    const fontPx = (shape.fontSize ?? shape.height) * sf;
    const textContent = (shape.label ?? '').trim();
    if (!textContent) return '';
    let sRot = 0;
    let sScaleX = 1;
    let sScaleY = 1;
    switch (shape.orientation ?? 'R0') {
      case 'R90': sRot = 90; break;
      case 'R180': sRot = 180; break;
      case 'R270': sRot = 270; break;
      case 'MX': sScaleY = -1; break;
      case 'MY': sScaleX = -1; break;
      case 'MXR90': sScaleY = -1; sRot = 90; break;
      case 'MYR90': sScaleX = -1; sRot = 90; break;
    }
    const fontWeight = shape.fontStyle?.includes('bold') ? 'bold' : 'normal';
    const fontStyleAttr = shape.fontStyle?.includes('italic') ? ' font-style="italic"' : '';
    const fontFamily = escapeXml(resolveTextFontFamilyCss(shape.fontFamily));
    return `${indent}<g transform="translate(${sx} ${sy}) rotate(${sRot}) scale(${sScaleX} ${sScaleY})"><text x="0" y="${-fontPx * 0.15}" fill="${escapeXml(style.color)}" font-family="${fontFamily}" font-size="${fontPx}" font-weight="${fontWeight}"${fontStyleAttr} dominant-baseline="alphabetic" transform="scale(1, -1)">${escapeXml(textContent)}</text></g>\n`;
  };

  // Top-level drawn shapes
  (state.shapes ?? []).forEach((shape) => {
    if (shape.kind === 'text') {
      svg += renderSvgTextShape(shape, 0, 0, '  ');
      return;
    }
    const style = resolveLayerStyle(shape.layer, shape.purpose, shape.color);
    const sx = shape.x * sf;
    const sy = shape.y * sf;
    const sw = shape.width * sf;
    const sh = shape.height * sf;
    const dashAttr = style.strokeDash === 'dashed' ? ' stroke-dasharray="6,4"' : '';
    svg += `  <rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="${escapeXml(style.color)}" fill-opacity="${style.fillOpacity}" stroke="${escapeXml(style.color)}" stroke-width="1.5"${dashAttr} vector-effect="non-scaling-stroke" />\n`;
    const tag = shape.label?.trim() || `${shape.layer}/${shape.purpose}`;
    const tagFS = Math.min(sw * 0.12, sh * 0.22, baseFS * 1.1);
    svg += `  <text x="${sx + sw / 2}" y="${-(sy + sh / 2)}" fill="${escapeXml(style.color)}" font-family="monospace" font-size="${tagFS}" font-weight="600" text-anchor="middle" dominant-baseline="middle" transform="scale(1, -1)">${escapeXml(tag)}</text>\n`;
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
    
    if (dist > 0) {
      const ux = dx / dist;
      const uy = dy / dist;
      const nx = -uy;
      const ny = ux;
      const tickLen = baseFS * 0.5;
      
      svg += `  <line x1="${sx - nx * tickLen}" y1="${sy - ny * tickLen}" x2="${sx + nx * tickLen}" y2="${sy + ny * tickLen}" stroke="#b45309" stroke-width="2" vector-effect="non-scaling-stroke" />\n`;
      svg += `  <line x1="${ex - nx * tickLen}" y1="${ey - ny * tickLen}" x2="${ex + nx * tickLen}" y2="${ey + ny * tickLen}" stroke="#b45309" stroke-width="2" vector-effect="non-scaling-stroke" />\n`;
      
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      const finalDist = formatGridValue(dist / sf, state.gridSize);
      
      let endTextString = `L: ${finalDist}`;
      if (absDx > 0.0001 && absDy > 0.0001) {
        const finalDx = formatGridValue(absDx / sf, state.gridSize);
        const finalDy = formatGridValue(absDy / sf, state.gridSize);
        endTextString += ` | dX: ${finalDx} | dY: ${finalDy}`;
        
        svg += `  <line x1="${sx}" y1="${sy}" x2="${ex}" y2="${sy}" stroke="#b45309" stroke-width="1.5" stroke-dasharray="8,8" opacity="0.8" vector-effect="non-scaling-stroke" />\n`;
        svg += `  <line x1="${ex}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="#b45309" stroke-width="1.5" stroke-dasharray="8,8" opacity="0.8" vector-effect="non-scaling-stroke" />\n`;
      }
      
      svg += `  <text x="${sx + nx * baseFS}" y="${-(sy + ny * baseFS)}" fill="#b45309" font-family="monospace" font-size="${smallFS}" dominant-baseline="middle" transform="scale(1, -1)">0</text>\n`;
      svg += `  <text x="${ex + nx * baseFS}" y="${-(ey + ny * baseFS)}" fill="#92400e" font-family="monospace" font-size="${baseFS}" font-weight="bold" dominant-baseline="middle" transform="scale(1, -1)">${escapeXml(endTextString)}</text>\n`;
    }
  });

  // ==========================================
  // Draw Data Table
  // ==========================================
  let curY = tableStartY;
  const colW = [tw * 0.2, tw * 0.2, tw * 0.15, tw * 0.15, tw * 0.15, tw * 0.15];
  let cx = -tw / 2;

  // Title
  svg += `  <text x="${cx}" y="${-curY}" fill="#0f172a" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Inter, sans-serif" font-size="${largeFS}" font-weight="bold" dominant-baseline="auto" transform="scale(1, -1)">Floorplan Data Summary</text>\n`;
  curY -= rowHeight * 1.5;

  // Header Background
  svg += `  <rect x="${-tw / 2}" y="${curY - rowHeight}" width="${tw}" height="${rowHeight}" fill="#1e293b" />\n`;
  
  const headers = ['Instance Name', 'Master Cell', 'X (um)', 'Y (um)', 'Orientation', 'Size (um)'];
  cx = -tw / 2;
  headers.forEach((h, i) => {
    svg += `  <text x="${cx + baseFS}" y="${-(curY - rowHeight / 2)}" fill="#f8fafc" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Inter, sans-serif" font-size="${baseFS}" font-weight="bold" dominant-baseline="middle" transform="scale(1, -1)">${h}</text>\n`;
    cx += colW[i];
  });
  curY -= rowHeight;

  // Rows
  sortedInstances.forEach((inst, idx) => {
    const m = state.masterCells[inst.cellId];
    if (!m) return;
    
    const bgColor = idx % 2 === 0 ? '#f1f5f9' : '#e2e8f0';
    svg += `  <rect x="${-tw / 2}" y="${curY - rowHeight}" width="${tw}" height="${rowHeight}" fill="${bgColor}" />\n`;
    
    cx = -tw / 2;
    const cellLabel = isActiveMosaic(inst.mosaic)
      ? `${m.cellName} [${inst.mosaic.rows}×${inst.mosaic.cols}]`
      : m.cellName;
    const rowData = [
      inst.name,
      cellLabel,
      formatGridValue(inst.x, state.gridSize),
      formatGridValue(inst.y, state.gridSize),
      inst.orientation,
      `${m.width} x ${m.height}`,
    ];
    
    rowData.forEach((d, i) => {
      svg += `  <text x="${cx + baseFS}" y="${-(curY - rowHeight / 2)}" fill="#0f172a" font-family="monospace" font-size="${baseFS}" dominant-baseline="middle" transform="scale(1, -1)">${escapeXml(d)}</text>\n`;
      cx += colW[i];
    });
    
    curY -= rowHeight;
  });
  
  // Table border
  const totalTableHeight = tableStartY - 1.5 * rowHeight - curY;
  svg += `  <rect x="${-tw / 2}" y="${curY}" width="${tw}" height="${totalTableHeight}" fill="none" stroke="#334155" stroke-width="2" vector-effect="non-scaling-stroke" />\n`;

  svg += `</g>\n</svg>`;
  return svg;
};

export const exportSVG = () => {
  const snapshot = getProjectSnapshot(useStore.getState());
  const svg = generateSvgMarkup(snapshot);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const filename = `${snapshot.topCellName}_floorplan.svg`;
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
};
