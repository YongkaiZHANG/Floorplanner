import React, { useEffect, useRef, useState } from 'react';
import {
  FiAlignCenter,
  FiAlignLeft,
  FiAlignRight,
  FiChevronDown,
  FiCornerDownLeft,
  FiCornerDownRight,
  FiMoreHorizontal,
  FiMoreVertical,
  FiColumns,
  FiMenu,
} from 'react-icons/fi';
import type { AlignmentEdge } from '../utils/alignment';
import './EditingToolbar.css';

export type AlignmentAction =
  | 'left'
  | 'horizontal-center'
  | 'right'
  | 'bottom'
  | 'vertical-center'
  | 'top'
  | 'space-horizontal'
  | 'space-vertical'
  | 'distribute-horizontal'
  | 'distribute-vertical';

type EditingToolbarProps = {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  selectionCount: number;
  anchorName?: string;
  boundaryLabel?: string;
  onUndo: () => void;
  onRedo: () => void;
  onAlign: (action: AlignmentAction, distance: number) => void;
  onAlignToBoundary: (edge: AlignmentEdge, distance: number) => void;
  onStartEdgeAlign: (initialDistance: string) => void;
};

const boundaryAlignmentItems: Array<{
  edge: AlignmentEdge;
  label: string;
  title: string;
  icon: React.ReactNode;
}> = [
  { edge: 'left', label: 'Left', title: 'Align left edge to boundary (inset by distance)', icon: <FiAlignLeft /> },
  { edge: 'horizontal-center', label: 'Center X', title: 'Center horizontally in boundary (+distance)', icon: <FiAlignCenter /> },
  { edge: 'right', label: 'Right', title: 'Align right edge to boundary (inset by distance)', icon: <FiAlignRight /> },
  { edge: 'bottom', label: 'Bottom', title: 'Align bottom edge to boundary (inset by distance)', icon: <FiAlignLeft className="editing-toolbar__vertical-icon" /> },
  { edge: 'vertical-center', label: 'Center Y', title: 'Center vertically in boundary (+distance)', icon: <FiAlignCenter className="editing-toolbar__vertical-icon" /> },
  { edge: 'top', label: 'Top', title: 'Align top edge to boundary (inset by distance)', icon: <FiAlignRight className="editing-toolbar__vertical-icon" /> },
];

const blockEdgeAlignmentItems: Array<{
  action: AlignmentAction;
  label: string;
  title: string;
  icon: React.ReactNode;
}> = [
  { action: 'left', label: 'Left', title: 'Align left edges to anchor (+distance)', icon: <FiAlignLeft /> },
  { action: 'horizontal-center', label: 'Center X', title: 'Align horizontal centers to anchor (+distance)', icon: <FiAlignCenter /> },
  { action: 'right', label: 'Right', title: 'Align right edges to anchor (-distance)', icon: <FiAlignRight /> },
  { action: 'bottom', label: 'Bottom', title: 'Align bottom edges to anchor (+distance)', icon: <FiAlignLeft className="editing-toolbar__vertical-icon" /> },
  { action: 'vertical-center', label: 'Center Y', title: 'Align vertical centers to anchor (+distance)', icon: <FiAlignCenter className="editing-toolbar__vertical-icon" /> },
  { action: 'top', label: 'Top', title: 'Align top edges to anchor (-distance)', icon: <FiAlignRight className="editing-toolbar__vertical-icon" /> },
];

export const EditingToolbar: React.FC<EditingToolbarProps> = ({
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  selectionCount,
  anchorName,
  boundaryLabel = 'Boundary',
  onUndo,
  onRedo,
  onAlign,
  onAlignToBoundary,
  onStartEdgeAlign,
}) => {
  const [isAlignOpen, setIsAlignOpen] = useState(false);
  const [distanceDraft, setDistanceDraft] = useState('0');
  const [lastNonZeroDistance, setLastNonZeroDistance] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const canAlign = selectionCount >= 1;

  const parseDistance = (): number => {
    const trimmed = distanceDraft.trim();
    if (trimmed === '') return 0;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : Number.NaN;
  };

  const rememberIfNonZero = (raw: string) => {
    const trimmed = raw.trim();
    const num = Number(trimmed);
    if (trimmed !== '' && Number.isFinite(num) && Math.abs(num) > 1e-9) {
      setLastNonZeroDistance(trimmed);
    }
  };

  useEffect(() => {
    if (!isAlignOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsAlignOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsAlignOpen(false);
    };

    window.addEventListener('pointerdown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isAlignOpen]);

  const parsedPreview = parseDistance();
  const hasValidDistance = Number.isFinite(parsedPreview);
  const isNonZeroDistance = hasValidDistance && Math.abs(parsedPreview) > 1e-9;

  return (
    <div className="editing-toolbar" ref={rootRef} aria-label="Editing controls">
      <button
        className="editing-toolbar__button editing-toolbar__button--icon"
        type="button"
        disabled={!canUndo}
        onClick={onUndo}
        title={canUndo && undoLabel ? `Undo: ${undoLabel} (Ctrl/Cmd+Z)` : 'Undo (Ctrl/Cmd+Z)'}
        aria-label="Undo"
      >
        <FiCornerDownLeft />
      </button>
      <button
        className="editing-toolbar__button editing-toolbar__button--icon"
        type="button"
        disabled={!canRedo}
        onClick={onRedo}
        title={canRedo && redoLabel ? `Redo: ${redoLabel} (Ctrl/Cmd+Shift+Z)` : 'Redo (Ctrl/Cmd+Shift+Z)'}
        aria-label="Redo"
      >
        <FiCornerDownRight />
      </button>

      <span className="editing-toolbar__divider" aria-hidden="true" />

      <button
        className="editing-toolbar__button editing-toolbar__align-trigger"
        type="button"
        disabled={!canAlign}
        onClick={() => {
          setIsAlignOpen((open) => {
            const next = !open;
            if (next) setDistanceDraft('0');
            return next;
          });
        }}
        aria-expanded={isAlignOpen}
        aria-haspopup="menu"
        title={canAlign
          ? `Align ${selectionCount === 1 ? (anchorName ?? 'selected block') : `${selectionCount} selected blocks`} (A)`
          : 'Select a block, rectangle, or pixel array to align'}
      >
        <FiAlignLeft />
        <span className="topbar-label-md">Align</span>
        <FiChevronDown />
      </button>

      {isAlignOpen && (
        <div className="editing-toolbar__menu" role="menu" aria-label="Alignment actions">
          <div className="editing-toolbar__menu-label">
            <strong>{anchorName ?? 'Selected block'}</strong> · {selectionCount} selected
          </div>
          <div className="editing-toolbar__distance-row">
            <label className="editing-toolbar__distance-label" htmlFor="align-menu-distance-input">
              Distance
            </label>
            <div className={`editing-toolbar__distance-field${!hasValidDistance ? ' is-invalid' : ''}`}>
              <input
                id="align-menu-distance-input"
                type="text"
                inputMode="decimal"
                value={distanceDraft}
                onChange={event => setDistanceDraft(event.target.value)}
                onFocus={event => event.currentTarget.select()}
                onKeyDown={event => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
                aria-label="Alignment distance in micrometers (default 0)"
              />
              <span>µm</span>
            </div>
            {distanceDraft.trim() !== '0' ? (
              <button
                type="button"
                className="editing-toolbar__distance-chip"
                onClick={() => setDistanceDraft('0')}
                title="Reset distance to default 0 µm"
              >
                0
              </button>
            ) : lastNonZeroDistance ? (
              <button
                type="button"
                className="editing-toolbar__distance-chip"
                onClick={() => setDistanceDraft(lastNonZeroDistance)}
                title={`Reuse last distance (${lastNonZeroDistance} µm)`}
              >
                {lastNonZeroDistance}
              </button>
            ) : null}
          </div>
          <button
            className="editing-toolbar__menu-item editing-toolbar__menu-item--primary"
            type="button"
            role="menuitem"
            onClick={() => {
              rememberIfNonZero(distanceDraft);
              onStartEdgeAlign(distanceDraft.trim() === '' ? '0' : distanceDraft.trim());
              setIsAlignOpen(false);
            }}
          >
            <FiAlignCenter />
            <span>
              <strong>Align by two edges…</strong>
              <small>Pick edge → IP, sub-cell, {boundaryLabel}, or ruler{isNonZeroDistance ? ` · ${distanceDraft.trim()} µm` : ''}</small>
            </span>
            <kbd className="kbd-hint">A</kbd>
          </button>
          <div className="editing-toolbar__menu-section">
            Align to {boundaryLabel} boundary{isNonZeroDistance ? ` · ${distanceDraft.trim()} µm` : ''}
          </div>
          <div className="editing-toolbar__boundary-grid">
            {boundaryAlignmentItems.map((item) => (
              <button
                key={`boundary-${item.edge}`}
                className="editing-toolbar__boundary-btn"
                type="button"
                role="menuitem"
                disabled={!hasValidDistance}
                title={`${item.title} (${boundaryLabel})`}
                onClick={() => {
                  rememberIfNonZero(distanceDraft);
                  onAlignToBoundary(item.edge, parsedPreview);
                  setIsAlignOpen(false);
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div className="editing-toolbar__menu-section">
            Align selected blocks{isNonZeroDistance ? ` · ${distanceDraft.trim()} µm` : ''}
          </div>
          <div className="editing-toolbar__boundary-grid">
            {blockEdgeAlignmentItems.map((item) => (
              <button
                key={item.action}
                className="editing-toolbar__boundary-btn editing-toolbar__boundary-btn--blocks"
                type="button"
                role="menuitem"
                disabled={selectionCount < 2 || !hasValidDistance}
                title={item.title}
                onClick={() => {
                  rememberIfNonZero(distanceDraft);
                  onAlign(item.action, parsedPreview);
                  setIsAlignOpen(false);
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div className="editing-toolbar__menu-section">Space &amp; distribute</div>
          <div className="editing-toolbar__space-grid">
            <button
              className="editing-toolbar__boundary-btn editing-toolbar__boundary-btn--blocks"
              type="button"
              role="menuitem"
              disabled={selectionCount < 2 || !hasValidDistance}
              title={`Pack selected blocks horizontally with ${hasValidDistance ? parsedPreview : 0} µm edge gap`}
              onClick={() => {
                rememberIfNonZero(distanceDraft);
                onAlign('space-horizontal', parsedPreview);
                setIsAlignOpen(false);
              }}
            >
              <FiColumns />
              <span>{isNonZeroDistance ? `Gap H (${distanceDraft.trim()})` : 'Abut H (0)'}</span>
            </button>
            <button
              className="editing-toolbar__boundary-btn editing-toolbar__boundary-btn--blocks"
              type="button"
              role="menuitem"
              disabled={selectionCount < 2 || !hasValidDistance}
              title={`Pack selected blocks vertically with ${hasValidDistance ? parsedPreview : 0} µm edge gap`}
              onClick={() => {
                rememberIfNonZero(distanceDraft);
                onAlign('space-vertical', parsedPreview);
                setIsAlignOpen(false);
              }}
            >
              <FiMenu />
              <span>{isNonZeroDistance ? `Gap V (${distanceDraft.trim()})` : 'Abut V (0)'}</span>
            </button>
            <button
              className="editing-toolbar__boundary-btn editing-toolbar__boundary-btn--blocks"
              type="button"
              role="menuitem"
              disabled={selectionCount < 3}
              title="Distribute horizontal gaps evenly between outermost blocks"
              onClick={() => {
                onAlign('distribute-horizontal', 0);
                setIsAlignOpen(false);
              }}
            >
              <FiMoreHorizontal />
              <span>Distribute H</span>
            </button>
            <button
              className="editing-toolbar__boundary-btn editing-toolbar__boundary-btn--blocks"
              type="button"
              role="menuitem"
              disabled={selectionCount < 3}
              title="Distribute vertical gaps evenly between outermost blocks"
              onClick={() => {
                onAlign('distribute-vertical', 0);
                setIsAlignOpen(false);
              }}
            >
              <FiMoreVertical />
              <span>Distribute V</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
