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
} from 'react-icons/fi';
import './EditingToolbar.css';

export type AlignmentAction =
  | 'left'
  | 'horizontal-center'
  | 'right'
  | 'bottom'
  | 'vertical-center'
  | 'top'
  | 'distribute-horizontal'
  | 'distribute-vertical';

type EditingToolbarProps = {
  canUndo: boolean;
  canRedo: boolean;
  selectionCount: number;
  anchorName?: string;
  onUndo: () => void;
  onRedo: () => void;
  onAlign: (action: AlignmentAction) => void;
  onStartEdgeAlign: () => void;
};

const alignmentItems: Array<{
  action: AlignmentAction;
  label: string;
  minimumSelection: number;
  icon: React.ReactNode;
}> = [
  { action: 'left', label: 'Align left edges', minimumSelection: 2, icon: <FiAlignLeft /> },
  { action: 'horizontal-center', label: 'Align horizontal centers', minimumSelection: 2, icon: <FiAlignCenter /> },
  { action: 'right', label: 'Align right edges', minimumSelection: 2, icon: <FiAlignRight /> },
  { action: 'bottom', label: 'Align bottom edges', minimumSelection: 2, icon: <FiAlignLeft className="editing-toolbar__vertical-icon" /> },
  { action: 'vertical-center', label: 'Align vertical centers', minimumSelection: 2, icon: <FiAlignCenter className="editing-toolbar__vertical-icon" /> },
  { action: 'top', label: 'Align top edges', minimumSelection: 2, icon: <FiAlignRight className="editing-toolbar__vertical-icon" /> },
  { action: 'distribute-horizontal', label: 'Distribute horizontally', minimumSelection: 3, icon: <FiMoreHorizontal /> },
  { action: 'distribute-vertical', label: 'Distribute vertically', minimumSelection: 3, icon: <FiMoreVertical /> },
];

export const EditingToolbar: React.FC<EditingToolbarProps> = ({
  canUndo,
  canRedo,
  selectionCount,
  anchorName,
  onUndo,
  onRedo,
  onAlign,
  onStartEdgeAlign,
}) => {
  const [isAlignOpen, setIsAlignOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canAlign = selectionCount >= 1;

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

  return (
    <div className="editing-toolbar" ref={rootRef} aria-label="Editing controls">
      <button
        className="editing-toolbar__button"
        type="button"
        disabled={!canUndo}
        onClick={onUndo}
        title="Undo (Ctrl/Cmd+Z)"
        aria-label="Undo"
      >
        <FiCornerDownLeft />
      </button>
      <button
        className="editing-toolbar__button"
        type="button"
        disabled={!canRedo}
        onClick={onRedo}
        title="Redo (Ctrl/Cmd+Shift+Z)"
        aria-label="Redo"
      >
        <FiCornerDownRight />
      </button>

      <span className="editing-toolbar__divider" aria-hidden="true" />

      <button
        className="editing-toolbar__button editing-toolbar__align-trigger"
        type="button"
        disabled={!canAlign}
        onClick={() => setIsAlignOpen((open) => !open)}
        aria-expanded={isAlignOpen}
        aria-haspopup="menu"
        title={canAlign ? `Align ${anchorName ?? 'the selected block'} by edges` : 'Select a source block to align'}
      >
        <FiAlignLeft />
        <span>Align</span>
        <FiChevronDown />
      </button>

      {isAlignOpen && (
        <div className="editing-toolbar__menu" role="menu" aria-label="Alignment actions">
          <div className="editing-toolbar__menu-label">
            <strong>{anchorName ?? 'Selected block'}</strong> · {selectionCount} selected
          </div>
          <button
            className="editing-toolbar__menu-item editing-toolbar__menu-item--primary"
            type="button"
            role="menuitem"
            onClick={() => {
              onStartEdgeAlign();
              setIsAlignOpen(false);
            }}
          >
            <FiAlignCenter />
            <span><strong>Align by two edges…</strong><small>Pick this block’s edge, then a fixed target edge</small></span>
          </button>
          <div className="editing-toolbar__menu-section">Quick align selected blocks</div>
          {alignmentItems.map((item) => (
            <button
              key={item.action}
              className="editing-toolbar__menu-item"
              type="button"
              role="menuitem"
              disabled={selectionCount < item.minimumSelection}
              onClick={() => {
                onAlign(item.action);
                setIsAlignOpen(false);
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
