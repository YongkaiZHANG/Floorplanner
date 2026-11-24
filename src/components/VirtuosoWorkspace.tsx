import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTransformProps, useStore } from '../store/useStore';
import type { Cell, Instance, PixelArray } from '../store/useStore';
import { FloorplanCanvas } from '../canvas/FloorplanCanvas';
import {
  FiArrowUp,
  FiChevronDown,
  FiChevronLeft,
  FiChevronRight,
  FiColumns,
  FiCornerDownRight,
  FiLayers,
  FiMaximize2,
  FiPlus,
  FiSearch,
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

/**
 * Full-width top cellview switcher bar (placed directly below Topbar and above
 * the collapsible sidebars so open cellview tabs are never hidden behind panels).
 */
export const VirtuosoCellViewBar: React.FC = () => {
  const {
    topLibName,
    topCellName,
    topWidth,
    topHeight,
    libraries,
    masterCells,
    instances,
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
  const [pickerQuery, setPickerQuery] = useState('');
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const tabRailRef = useRef<HTMLDivElement>(null);

  const rootLibName = rootView?.topLibName ?? topLibName;
  const rootCellName = rootView?.topCellName ?? topCellName;
  const rootWidth = rootView?.topWidth ?? topWidth;
  const rootHeight = rootView?.topHeight ?? topHeight;

  const updateScrollButtons = useCallback(() => {
    const el = tabRailRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateScrollButtons();
    const el = tabRailRef.current;
    if (!el) return;
    const activeTab = el.querySelector<HTMLElement>('.virtuoso-tab.active');
    activeTab?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [activeCellId, openViewIds.length, updateScrollButtons]);

  useEffect(() => {
    const handleResize = () => updateScrollButtons();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateScrollButtons]);

  useEffect(() => {
    if (!openPickerVisible) return;
    const handleOutside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpenPickerVisible(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenPickerVisible(false);
    };
    window.addEventListener('pointerdown', handleOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handleOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [openPickerVisible]);

  const scrollTabs = (direction: -1 | 1) => {
    const el = tabRailRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * 220, behavior: 'smooth' });
  };

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

  const normalizedQuery = pickerQuery.trim().toLowerCase();

  return (
    <div className="virtuoso-strip" role="toolbar" aria-label="Open cellview switcher and hierarchy bar">
      <div className="virtuoso-strip__left">
        {canScrollLeft && (
          <button
            type="button"
            className="virtuoso-scroll-btn"
            onClick={() => scrollTabs(-1)}
            title="Scroll open cellviews left"
            aria-label="Scroll open cellviews left"
          >
            <FiChevronLeft />
          </button>
        )}
        <div
          className="virtuoso-strip__tabs"
          ref={tabRailRef}
          onScroll={updateScrollButtons}
          role="tablist"
          aria-label="Open Virtuoso cellviews"
        >
          {openViewIds.map(tabId => {
            const isRoot = tabId === null;
            const tabMaster = tabId ? masterCells[tabId] : null;
            if (!isRoot && !tabMaster) return null;
            const isActive = activeCellId === tabId;
            const lib = isRoot ? rootLibName : tabMaster!.libName;
            const cell = isRoot ? rootCellName : tabMaster!.cellName;
            const dims = isRoot
              ? `${rootWidth.toFixed(1)} × ${rootHeight.toFixed(1)} µm`
              : `${tabMaster!.width.toFixed(1)} × ${tabMaster!.height.toFixed(1)} µm`;
            return (
              <div
                key={tabId ?? '__root__'}
                className={`virtuoso-tab${isActive ? ' active' : ''}`}
                onAuxClick={event => {
                  if (event.button === 1 && openViewIds.length > 1) {
                    event.preventDefault();
                    closeCellViewTab(tabId);
                  }
                }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className="virtuoso-tab__btn"
                  onClick={() => openCellView(tabId)}
                  title={`${lib} / ${cell} / layout (${dims})`}
                >
                  <span
                    className="virtuoso-tab__swatch"
                    style={{ backgroundColor: isRoot ? '#2997ff' : tabMaster!.color }}
                  />
                  <span className="virtuoso-tab__lib">{lib}</span>
                  <span className="virtuoso-tab__sep">/</span>
                  <span className="virtuoso-tab__cell">{cell}</span>
                  {isRoot && <span className="virtuoso-tab__top">TOP</span>}
                </button>
                {openViewIds.length > 1 && (
                  <button
                    type="button"
                    className="virtuoso-tab__close"
                    onClick={() => closeCellViewTab(tabId)}
                    title={`Close ${cell} tab`}
                    aria-label={`Close ${cell} tab`}
                  >
                    <FiX />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {canScrollRight && (
          <button
            type="button"
            className="virtuoso-scroll-btn"
            onClick={() => scrollTabs(1)}
            title="Scroll open cellviews right"
            aria-label="Scroll open cellviews right"
          >
            <FiChevronRight />
          </button>
        )}

        <div className="virtuoso-open-menu" ref={pickerRef}>
          <button
            type="button"
            className="virtuoso-open-btn"
            onClick={() => {
              setPickerQuery('');
              setOpenPickerVisible(open => !open);
            }}
            aria-expanded={openPickerVisible}
            title="Open or switch to any cellview across libraries"
          >
            <FiPlus /> <span>Open Cellview</span>
            {openViewIds.length > 1 && <span className="virtuoso-open-count">{openViewIds.length}</span>}
            <FiChevronDown />
          </button>
          {openPickerVisible && (
            <div className="virtuoso-open-dropdown" role="menu">
              <div className="virtuoso-open-search">
                <FiSearch className="virtuoso-open-search__icon" />
                <input
                  type="text"
                  className="virtuoso-open-search__input"
                  placeholder="Search library or cell…"
                  value={pickerQuery}
                  onChange={event => setPickerQuery(event.target.value)}
                  autoFocus
                />
              </div>
              <div className="virtuoso-open-list">
                {allLibraries.map(lib => {
                  const topMatches = rootLibName === lib && (
                    !normalizedQuery
                    || rootCellName.toLowerCase().includes(normalizedQuery)
                    || lib.toLowerCase().includes(normalizedQuery)
                  );
                  const cells = Object.values(masterCells)
                    .filter(cell => cell.libName === lib)
                    .filter(cell => (
                      !normalizedQuery
                      || cell.cellName.toLowerCase().includes(normalizedQuery)
                      || lib.toLowerCase().includes(normalizedQuery)
                    ))
                    .sort((a, b) => a.cellName.localeCompare(b.cellName));
                  if (!topMatches && cells.length === 0) return null;
                  return (
                    <div key={lib} className="virtuoso-open-group">
                      <div className="virtuoso-open-group__lib">{lib}</div>
                      {topMatches && (
                        <div className="virtuoso-open-row">
                          <button
                            type="button"
                            className={`virtuoso-open-row__main${activeCellId === null ? ' active' : ''}`}
                            onClick={() => {
                              openCellView(null);
                              setOpenPickerVisible(false);
                            }}
                          >
                            <span className="virtuoso-open-row__name">
                              <i className="virtuoso-tab__swatch" style={{ backgroundColor: '#2997ff' }} />
                              {rootCellName}
                              {openViewIds.includes(null) && <em className="virtuoso-open-dot" title="Already open" />}
                            </span>
                            <small>TOP · {rootWidth}×{rootHeight}</small>
                          </button>
                          <button
                            type="button"
                            className="virtuoso-open-row__split"
                            onClick={() => {
                              openCellViewInNewWindow(null);
                              setOpenPickerVisible(false);
                            }}
                            title={`Open ${rootCellName} side-by-side`}
                          >
                            <FiColumns />
                          </button>
                        </div>
                      )}
                      {cells.map(cell => (
                        <div key={cell.id} className="virtuoso-open-row">
                          <button
                            type="button"
                            className={`virtuoso-open-row__main${activeCellId === cell.id ? ' active' : ''}`}
                            onClick={() => {
                              openCellView(cell.id);
                              setOpenPickerVisible(false);
                            }}
                          >
                            <span className="virtuoso-open-row__name">
                              <i className="virtuoso-tab__swatch" style={{ backgroundColor: cell.color }} />
                              {cell.cellName}
                              {openViewIds.includes(cell.id) && <em className="virtuoso-open-dot" title="Already open" />}
                            </span>
                            <small>{cell.width}×{cell.height}</small>
                          </button>
                          <button
                            type="button"
                            className="virtuoso-open-row__split"
                            onClick={() => {
                              openCellViewInNewWindow(cell.id);
                              setOpenPickerVisible(false);
                            }}
                            title={`Open ${cell.cellName} side-by-side`}
                          >
                            <FiColumns />
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="virtuoso-strip__controls">
        {viewBreadcrumb.length > 0 && (
          <nav className="virtuoso-inline-crumb" aria-label="Hierarchy path">
            <FiLayers className="virtuoso-window__hier-icon" />
            <button
              type="button"
              className="virtuoso-crumb"
              onClick={() => navigateBreadcrumb(-1)}
              title={`Return to ${rootLibName}/${rootCellName}`}
            >
              {rootCellName}
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
                    {crumbCell.cellName}
                  </button>
                </React.Fragment>
              );
            })}
          </nav>
        )}
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
          <FiCornerDownRight /> <span className="virtuoso-ctrl-label">Descend</span>
        </button>
        <button
          type="button"
          className="virtuoso-ctrl-btn"
          disabled={activeCellId === null}
          onClick={ascendToParent}
          title="Return up one hierarchy level (Ctrl+B / Shift+B)"
        >
          <FiArrowUp /> <span className="virtuoso-ctrl-label">Return</span>
        </button>
        <button
          type="button"
          className={`virtuoso-ctrl-btn${windowLayoutMode === 'split' ? ' active' : ''}`}
          disabled={openViewIds.length < 2}
          onClick={() => setWindowLayoutMode(windowLayoutMode === 'split' ? 'tabs' : 'split')}
          title={
            openViewIds.length < 2
              ? 'Open a second cellview tab to enable side-by-side Split View'
              : windowLayoutMode === 'split'
                ? 'Switch back to full-width tabbed view'
                : 'Compare another open cellview side-by-side'
          }
          aria-pressed={windowLayoutMode === 'split'}
        >
          <FiColumns /> <span className="virtuoso-ctrl-label">Split</span>
        </button>
      </div>
    </div>
  );
};

const CompanionCellViewWindow: React.FC<{
  view: ResolvedViewData;
  otherViews: ResolvedViewData[];
  masterCells: Record<string, Cell>;
  cellViews: ReturnType<typeof useStore.getState>['cellViews'];
  activeCellId: string | null;
  activeInstances: Instance[];
  onSelectCompanion: (cellId: string | null) => void;
  onActivate: () => void;
  onClose: () => void;
}> = ({
  view,
  otherViews,
  masterCells,
  cellViews,
  activeCellId,
  activeInstances,
  onSelectCompanion,
  onActivate,
  onClose,
}) => {
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
      aria-label={`${view.libName}/${view.cellName} companion layout window`}
    >
      <header className="virtuoso-window__header">
        <div className="virtuoso-window__identity">
          <span className="virtuoso-window__dot" />
          {otherViews.length > 1 ? (
            <select
              className="virtuoso-companion-select"
              value={view.id ?? '__root__'}
              onChange={event => {
                const raw = event.target.value;
                onSelectCompanion(raw === '__root__' ? null : raw);
              }}
              aria-label="Choose companion cellview"
            >
              {otherViews.map(candidate => (
                <option key={candidate.id ?? '__root__'} value={candidate.id ?? '__root__'}>
                  {candidate.libName}/{candidate.cellName} (layout){candidate.isRoot ? ' · TOP' : ''}
                </option>
              ))}
            </select>
          ) : (
            <>
              <span className="virtuoso-window__lib">{view.libName}</span>
              <span className="virtuoso-window__sep">/</span>
              <strong className="virtuoso-window__cell">{view.cellName}</strong>
              <span className="virtuoso-window__view">layout</span>
              {view.isRoot && <span className="virtuoso-window__badge">TOP</span>}
            </>
          )}
          <span className="virtuoso-window__dims">
            {view.width.toFixed(1)} × {view.height.toFixed(1)} µm
          </span>
        </div>
        <div className="virtuoso-window__actions">
          <button
            type="button"
            className="virtuoso-window__btn virtuoso-window__btn--focus"
            onClick={onActivate}
            title={`Switch active editor into ${view.cellName} (layout)`}
          >
            <FiMaximize2 /> Edit
          </button>
          <button
            type="button"
            className="virtuoso-window__btn"
            onClick={onClose}
            title="Close split pane"
            aria-label="Close split pane"
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
            {view.pixelArray?.visible && (
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
            )}
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
          Click anywhere to edit {view.cellName} (layout)
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
    masterCells,
    instances,
    pixelArray,
    cellViews,
    activeCellId,
    openViewIds,
    windowLayoutMode,
    rootView,
    openCellView,
    setWindowLayoutMode,
  } = useStore();

  const [preferredCompanionId, setPreferredCompanionId] = useState<string | null>(null);

  const companionCandidates = useMemo(() => {
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

  const companionView = useMemo(() => {
    if (companionCandidates.length === 0) return null;
    return (
      companionCandidates.find(candidate => candidate.id === preferredCompanionId)
      ?? companionCandidates[0]
    );
  }, [companionCandidates, preferredCompanionId]);

  const isSplit = Boolean(companionView);

  return (
    <div className="virtuoso-workspace">
      <div className={`virtuoso-panes${isSplit ? ' virtuoso-panes--split' : ''}`}>
        <section
          className="virtuoso-window virtuoso-window--active"
          aria-label={`Active editor: ${topLibName}/${topCellName} layout`}
        >
          {isSplit && (
            <header className="virtuoso-window__header virtuoso-window__header--active">
              <div className="virtuoso-window__identity">
                <span className="virtuoso-window__dot virtuoso-window__dot--active" />
                <span className="virtuoso-window__lib">{topLibName}</span>
                <span className="virtuoso-window__sep">/</span>
                <strong className="virtuoso-window__cell">{topCellName}</strong>
                <span className="virtuoso-window__view">layout</span>
                <span className="virtuoso-window__dims">
                  {topWidth.toFixed(1)} × {topHeight.toFixed(1)} µm
                </span>
              </div>
            </header>
          )}
          <div className="virtuoso-window__body">
            <FloorplanCanvas />
          </div>
        </section>

        {companionView && (
          <CompanionCellViewWindow
            view={companionView}
            otherViews={companionCandidates}
            masterCells={masterCells}
            cellViews={cellViews}
            activeCellId={activeCellId}
            activeInstances={instances}
            onSelectCompanion={setPreferredCompanionId}
            onActivate={() => openCellView(companionView.id)}
            onClose={() => setWindowLayoutMode('tabs')}
          />
        )}
      </div>
    </div>
  );
};
