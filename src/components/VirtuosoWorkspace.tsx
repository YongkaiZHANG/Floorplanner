import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getTransformProps, useStore } from '../store/useStore';
import type { Cell, Instance, PixelArray } from '../store/useStore';
import { FloorplanCanvas } from '../canvas/FloorplanCanvas';
import {
  FiArrowUp,
  FiChevronDown,
  FiChevronRight,
  FiColumns,
  FiCornerDownRight,
  FiLayers,
  FiMaximize2,
  FiPlus,
  FiSquare,
  FiX,
} from 'react-icons/fi';
import './VirtuosoWorkspace.css';

type ResolvedViewData = {
  id: string | null;
  isRoot: boolean;
  libName: string;
  cellName: string;
  width: number;
  height: number;
  padInset: number;
  instances: Instance[];
  pixelArray: PixelArray | null;
};

const SecondaryCellViewWindow: React.FC<{
  view: ResolvedViewData;
  masterCells: Record<string, Cell>;
  cellViews: ReturnType<typeof useStore.getState>['cellViews'];
  activeCellId: string | null;
  activeInstances: Instance[];
  onActivate: () => void;
  onClose: () => void;
}> = ({ view, masterCells, cellViews, activeCellId, activeInstances, onActivate, onClose }) => {
  const pad = Math.max(view.width, view.height) * 0.14;
  const vbX = -view.width / 2 - pad;
  const vbY = -view.height / 2 - pad;
  const vbW = view.width + pad * 2;
  const vbH = view.height + pad * 2;
  const labelSize = Math.max(view.width, view.height) * 0.022;

  const sortedInstances = useMemo(
    () =>
      [...view.instances].sort((a, b) => {
        const mA = masterCells[a.cellId];
        const mB = masterCells[b.cellId];
        if (!mA || !mB) return 0;
        return mB.width * mB.height - mA.width * mA.height;
      }),
    [view.instances, masterCells],
  );

  const getLiveSubInstances = (cellId: string): Instance[] => {
    if (cellId === activeCellId) return activeInstances;
    return cellViews[cellId]?.instances ?? [];
  };

  return (
    <section
      className="virtuoso-window virtuoso-window--secondary"
      aria-label={`${view.libName}/${view.cellName} layout window`}
    >
      <header className="virtuoso-window__header" onClick={onActivate}>
        <div className="virtuoso-window__identity">
          <span className="virtuoso-window__dot" />
          <span className="virtuoso-window__lib">{view.libName}</span>
          <span className="virtuoso-window__sep">/</span>
          <strong className="virtuoso-window__cell">{view.cellName}</strong>
          <span className="virtuoso-window__view">layout</span>
          {view.isRoot && <span className="virtuoso-window__badge">TOP</span>}
          <span className="virtuoso-window__dims">
            {view.width.toFixed(1)} × {view.height.toFixed(1)} µm
          </span>
        </div>
        <div className="virtuoso-window__actions">
          <button
            type="button"
            className="virtuoso-window__btn virtuoso-window__btn--focus"
            onClick={event => {
              event.stopPropagation();
              onActivate();
            }}
            title={`Switch active editor into ${view.cellName} (layout)`}
          >
            <FiMaximize2 /> Edit
          </button>
          <button
            type="button"
            className="virtuoso-window__btn"
            onClick={event => {
              event.stopPropagation();
              onClose();
            }}
            title={`Close ${view.cellName} window`}
            aria-label={`Close ${view.cellName} window`}
          >
            <FiX />
          </button>
        </div>
      </header>

      <div
        className="virtuoso-window__preview"
        onClick={onActivate}
        title={`Click to activate and edit ${view.libName}/${view.cellName} (layout)`}
      >
        <svg
          className="virtuoso-preview-svg"
          viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <g transform="scale(1, -1)">
            {/* Origin axes */}
            <line
              x1={vbX}
              y1={0}
              x2={vbX + vbW}
              y2={0}
              stroke="#cbd5e1"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={0}
              y1={vbY}
              x2={0}
              y2={vbY + vbH}
              stroke="#cbd5e1"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />

            {/* Cell prBoundary */}
            <rect
              x={-view.width / 2}
              y={-view.height / 2}
              width={view.width}
              height={view.height}
              fill="#ffffff"
              stroke="#475569"
              strokeWidth={1.75}
              strokeDasharray="8,6"
              vectorEffect="non-scaling-stroke"
            />

            {/* Optional seal-ring / pad inset */}
            {view.padInset > 0 && (
              <rect
                x={-view.width / 2 + view.padInset}
                y={-view.height / 2 + view.padInset}
                width={view.width - view.padInset * 2}
                height={view.height - view.padInset * 2}
                fill="none"
                stroke="#d97706"
                strokeWidth={1}
                strokeDasharray="5,5"
                opacity={0.6}
                vectorEffect="non-scaling-stroke"
              />
            )}

            {/* Visible Pixel Array overlay */}
            {view.pixelArray?.visible && (
              <g>
                <rect
                  x={view.pixelArray.x}
                  y={view.pixelArray.y}
                  width={view.pixelArray.width}
                  height={view.pixelArray.height}
                  fill="#8b5cf6"
                  fillOpacity={0.14}
                  stroke="#7c3aed"
                  strokeWidth={1.5}
                  strokeDasharray="6,4"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}

            {/* Instances inside this cell view (with live sub-hierarchy preview) */}
            {sortedInstances.map(inst => {
              const master = masterCells[inst.cellId];
              if (!master) return null;
              const t = getTransformProps(inst.orientation);
              const subInstances = getLiveSubInstances(inst.cellId);
              const instFS = Math.min(master.width * 0.18, master.height * 0.28, labelSize * 1.6);
              return (
                <g
                  key={inst.id}
                  transform={`translate(${inst.x} ${inst.y}) rotate(${t.rotation}) scale(${t.scaleX} ${t.scaleY})`}
                >
                  <rect
                    width={master.width}
                    height={master.height}
                    fill={master.color}
                    fillOpacity={master.opacity ?? 0.5}
                    stroke={master.outlineStyle === 'none' ? 'none' : '#1e293b'}
                    strokeWidth={1.25}
                    strokeDasharray={
                      master.outlineStyle === 'dashed'
                        ? '6,4'
                        : master.outlineStyle === 'dotted'
                          ? '2,3'
                          : undefined
                    }
                    vectorEffect="non-scaling-stroke"
                  />
                  {subInstances.length > 0 && (
                    <g transform={`translate(${master.width / 2} ${master.height / 2})`}>
                      {subInstances.map(sub => {
                        const subMaster = masterCells[sub.cellId];
                        if (!subMaster) return null;
                        const st = getTransformProps(sub.orientation);
                        return (
                          <g
                            key={sub.id}
                            transform={`translate(${sub.x} ${sub.y}) rotate(${st.rotation}) scale(${st.scaleX} ${st.scaleY})`}
                          >
                            <rect
                              width={subMaster.width}
                              height={subMaster.height}
                              fill={subMaster.color}
                              fillOpacity={Math.min(0.7, (subMaster.opacity ?? 0.5) * 0.85)}
                              stroke="#0f172a"
                              strokeWidth={0.75}
                              strokeOpacity={0.55}
                              vectorEffect="non-scaling-stroke"
                            />
                          </g>
                        );
                      })}
                    </g>
                  )}
                  <text
                    x={master.width / 2}
                    y={master.height / 2}
                    fill="#0f172a"
                    fontSize={instFS}
                    fontWeight={700}
                    fontFamily="-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`scale(1, -1) translate(0, ${-master.height})`}
                  >
                    {master.cellName}
                  </text>
                </g>
              );
            })}

            {/* Cell header text */}
            <text
              x={-view.width / 2}
              y={-(view.height / 2 + labelSize * 0.85)}
              fill="#334155"
              fontSize={labelSize}
              fontWeight={600}
              fontFamily="-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
              transform="scale(1, -1)"
            >
              {view.libName}/{view.cellName} ({view.width} × {view.height} µm)
            </text>
          </g>
        </svg>

        <div className="virtuoso-window__click-hint">
          Click anywhere in this window to edit {view.cellName} (layout)
        </div>
      </div>
    </section>
  );
};

export const VirtuosoWorkspace: React.FC = () => {
  const {
    topWidth,
    topHeight,
    topLibName,
    topCellName,
    padInset,
    libraries,
    masterCells,
    instances,
    pixelArray,
    cellViews,
    activeCellId,
    openViewIds,
    windowLayoutMode,
    viewBreadcrumb,
    rootView,
    selectedInstanceId,
    openCellView,
    openCellViewInNewWindow,
    setWindowLayoutMode,
    closeCellViewTab,
    descendIntoInstance,
    ascendToParent,
    navigateBreadcrumb,
  } = useStore();

  const [openPickerVisible, setOpenPickerVisible] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openPickerVisible) return;
    const handleOutside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpenPickerVisible(false);
      }
    };
    window.addEventListener('pointerdown', handleOutside);
    return () => window.removeEventListener('pointerdown', handleOutside);
  }, [openPickerVisible]);

  const rootLibName = rootView?.topLibName ?? topLibName;
  const rootCellName = rootView?.topCellName ?? topCellName;

  const secondaryViews = useMemo(() => {
    if (windowLayoutMode !== 'split') return [];
    const resolveView = (cellId: string | null): ResolvedViewData | null => {
      if (cellId === null) {
        if (activeCellId === null) {
          return {
            id: null,
            isRoot: true,
            libName: topLibName,
            cellName: topCellName,
            width: topWidth,
            height: topHeight,
            padInset,
            instances,
            pixelArray,
          };
        }
        if (!rootView) return null;
        return {
          id: null,
          isRoot: true,
          libName: rootView.topLibName,
          cellName: rootView.topCellName,
          width: rootView.topWidth,
          height: rootView.topHeight,
          padInset: rootView.padInset,
          instances: rootView.instances,
          pixelArray: rootView.pixelArray,
        };
      }

      const master = masterCells[cellId];
      if (!master) return null;
      if (activeCellId === cellId) {
        return {
          id: cellId,
          isRoot: false,
          libName: topLibName,
          cellName: topCellName,
          width: topWidth,
          height: topHeight,
          padInset,
          instances,
          pixelArray,
        };
      }
      const savedView = cellViews[cellId];
      return {
        id: cellId,
        isRoot: false,
        libName: master.libName,
        cellName: master.cellName,
        width: master.width,
        height: master.height,
        padInset: savedView?.padInset ?? 0,
        instances: savedView?.instances ?? [],
        pixelArray: savedView?.pixelArray ?? null,
      };
    };

    return openViewIds
      .filter(id => id !== activeCellId)
      .map(resolveView)
      .filter((view): view is ResolvedViewData => view !== null);
  }, [
    windowLayoutMode,
    openViewIds,
    activeCellId,
    masterCells,
    cellViews,
    rootView,
    topLibName,
    topCellName,
    topWidth,
    topHeight,
    padInset,
    instances,
    pixelArray,
  ]);

  const selectedInstance = selectedInstanceId
    ? instances.find(inst => inst.id === selectedInstanceId) ?? null
    : null;
  const selectedMaster = selectedInstance ? masterCells[selectedInstance.cellId] ?? null : null;

  const allLibraries = useMemo(() => {
    const libs = new Set<string>(libraries);
    libs.add(rootLibName);
    for (const cell of Object.values(masterCells)) {
      libs.add(cell.libName);
    }
    return [...libs].sort((a, b) => a.localeCompare(b));
  }, [libraries, rootLibName, masterCells]);

  return (
    <div className="virtuoso-workspace">
      <div className="virtuoso-strip" role="toolbar" aria-label="Virtuoso cellview windows and hierarchy">
        <div className="virtuoso-strip__tabs" role="tablist" aria-label="Open Virtuoso layout windows">
          {openViewIds.map(tabId => {
            const isRoot = tabId === null;
            const tabMaster = tabId ? masterCells[tabId] : null;
            if (!isRoot && !tabMaster) return null;
            const isActive = activeCellId === tabId;
            const lib = isRoot ? rootLibName : tabMaster!.libName;
            const cell = isRoot ? rootCellName : tabMaster!.cellName;
            return (
              <div key={tabId ?? '__root__'} className={`virtuoso-tab${isActive ? ' active' : ''}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className="virtuoso-tab__btn"
                  onClick={() => openCellView(tabId)}
                  title={`Focus ${lib}/${cell}/layout`}
                >
                  <span className="virtuoso-tab__dot" />
                  <span className="virtuoso-tab__lib">{lib}</span>
                  <span className="virtuoso-tab__sep">/</span>
                  <span className="virtuoso-tab__cell">{cell}</span>
                  <span className="virtuoso-tab__view">layout</span>
                  {isRoot && <span className="virtuoso-tab__top">TOP</span>}
                </button>
                {openViewIds.length > 1 && (
                  <button
                    type="button"
                    className="virtuoso-tab__close"
                    onClick={() => closeCellViewTab(tabId)}
                    title={`Close ${cell} window`}
                    aria-label={`Close ${cell} window`}
                  >
                    <FiX />
                  </button>
                )}
              </div>
            );
          })}

          <div className="virtuoso-open-menu" ref={pickerRef}>
            <button
              type="button"
              className="virtuoso-open-btn"
              onClick={() => setOpenPickerVisible(open => !open)}
              aria-expanded={openPickerVisible}
              title="Open any cellview (current tab or separate split window)"
            >
              <FiPlus /> <span>Open Cellview</span> <FiChevronDown />
            </button>
            {openPickerVisible && (
              <div className="virtuoso-open-dropdown" role="menu">
                {allLibraries.map(lib => {
                  const hasTop = rootLibName === lib;
                  const cells = Object.values(masterCells)
                    .filter(cell => cell.libName === lib)
                    .sort((a, b) => a.cellName.localeCompare(b.cellName));
                  if (!hasTop && cells.length === 0) return null;
                  return (
                    <div key={lib} className="virtuoso-open-group">
                      <div className="virtuoso-open-group__lib">{lib}</div>
                      {hasTop && (
                        <div className="virtuoso-open-row">
                          <button
                            type="button"
                            className="virtuoso-open-row__main"
                            onClick={() => {
                              openCellView(null);
                              setOpenPickerVisible(false);
                            }}
                          >
                            <span>{rootCellName}</span>
                            <small>layout · TOP</small>
                          </button>
                          <button
                            type="button"
                            className="virtuoso-open-row__split"
                            onClick={() => {
                              openCellViewInNewWindow(null);
                              setOpenPickerVisible(false);
                            }}
                            title={`Open ${rootCellName} in separate split window`}
                          >
                            <FiColumns />
                          </button>
                        </div>
                      )}
                      {cells.map(cell => (
                        <div key={cell.id} className="virtuoso-open-row">
                          <button
                            type="button"
                            className="virtuoso-open-row__main"
                            onClick={() => {
                              openCellView(cell.id);
                              setOpenPickerVisible(false);
                            }}
                          >
                            <span>{cell.cellName}</span>
                            <small>layout · {cell.width}×{cell.height}</small>
                          </button>
                          <button
                            type="button"
                            className="virtuoso-open-row__split"
                            onClick={() => {
                              openCellViewInNewWindow(cell.id);
                              setOpenPickerVisible(false);
                            }}
                            title={`Open ${cell.cellName} in separate split window`}
                          >
                            <FiColumns />
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="virtuoso-strip__controls">
          <button
            type="button"
            className="virtuoso-ctrl-btn"
            disabled={!selectedInstance}
            onClick={() => {
              if (selectedInstance) descendIntoInstance(selectedInstance.id);
            }}
            title={
              selectedMaster
                ? `Descend Edit into ${selectedMaster.libName}/${selectedMaster.cellName}/layout (X)`
                : 'Select an instance to descend into its cellview (X)'
            }
          >
            <FiCornerDownRight /> <span>Descend</span>
          </button>
          <button
            type="button"
            className="virtuoso-ctrl-btn"
            disabled={activeCellId === null}
            onClick={ascendToParent}
            title="Return up one hierarchy level (Ctrl+B / Shift+B)"
          >
            <FiArrowUp /> <span>Return</span>
          </button>
          <div className="virtuoso-layout-toggle" role="group" aria-label="Window layout mode">
            <button
              type="button"
              className={`virtuoso-ctrl-btn${windowLayoutMode === 'tabs' ? ' active' : ''}`}
              onClick={() => setWindowLayoutMode('tabs')}
              title="Single tabbed window"
            >
              <FiSquare />
            </button>
            <button
              type="button"
              className={`virtuoso-ctrl-btn${windowLayoutMode === 'split' ? ' active' : ''}`}
              disabled={openViewIds.length < 2}
              onClick={() => setWindowLayoutMode('split')}
              title={
                openViewIds.length < 2
                  ? 'Open a second cellview to view windows side-by-side'
                  : 'Show open cellviews in separate side-by-side Virtuoso windows'
              }
            >
              <FiColumns /> <span>Split</span>
            </button>
          </div>
        </div>
      </div>

      <div className={`virtuoso-panes${secondaryViews.length > 0 ? ' virtuoso-panes--split' : ''}`}>
        <section
          className="virtuoso-window virtuoso-window--active"
          aria-label={`Active editor: ${topLibName}/${topCellName} layout`}
        >
          {(secondaryViews.length > 0 || activeCellId !== null) && (
            <header className="virtuoso-window__header virtuoso-window__header--active">
              <div className="virtuoso-window__identity">
                <span className="virtuoso-window__dot virtuoso-window__dot--active" />
                <FiLayers className="virtuoso-window__hier-icon" />
                <button
                  type="button"
                  className={`virtuoso-crumb${activeCellId === null ? ' active' : ''}`}
                  onClick={() => navigateBreadcrumb(-1)}
                >
                  <span>{rootLibName}/{rootCellName}</span>
                </button>
                {viewBreadcrumb.map((crumbId, idx) => {
                  const crumbCell = masterCells[crumbId];
                  if (!crumbCell) return null;
                  const isCurrent = idx === viewBreadcrumb.length - 1;
                  return (
                    <React.Fragment key={`${crumbId}-${idx}`}>
                      <FiChevronRight className="virtuoso-crumb-sep" />
                      <button
                        type="button"
                        className={`virtuoso-crumb${isCurrent ? ' active' : ''}`}
                        onClick={() => navigateBreadcrumb(idx)}
                      >
                        <span>{crumbCell.libName}/{crumbCell.cellName}</span>
                      </button>
                    </React.Fragment>
                  );
                })}
                <span className="virtuoso-window__view">layout</span>
                <span className="virtuoso-window__dims">
                  {topWidth.toFixed(1)} × {topHeight.toFixed(1)} µm
                </span>
              </div>
              <div className="virtuoso-window__actions">
                {activeCellId !== null && (
                  <button
                    type="button"
                    className="virtuoso-window__btn virtuoso-window__btn--return"
                    onClick={ascendToParent}
                    title="Return up one hierarchy level (Ctrl+B / Shift+B)"
                  >
                    <FiArrowUp /> Return
                  </button>
                )}
              </div>
            </header>
          )}
          <div className="virtuoso-window__body">
            <FloorplanCanvas />
          </div>
        </section>

        {secondaryViews.length > 0 && (
          <div className="virtuoso-secondary-column">
            {secondaryViews.map(view => (
              <SecondaryCellViewWindow
                key={view.id ?? '__root__'}
                view={view}
                masterCells={masterCells}
                cellViews={cellViews}
                activeCellId={activeCellId}
                activeInstances={instances}
                onActivate={() => openCellView(view.id)}
                onClose={() => closeCellViewTab(view.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
