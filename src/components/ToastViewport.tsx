import React from 'react';
import { FiAlertTriangle, FiCheckCircle, FiInfo, FiX, FiXCircle } from 'react-icons/fi';
import './ToastViewport.css';

export type ToastKind = 'success' | 'info' | 'warning' | 'error';

export type ToastMessage = {
  id: string;
  kind: ToastKind;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

type ToastViewportProps = {
  messages: ToastMessage[];
  onDismiss: (id: string) => void;
};

const icons: Record<ToastKind, React.ReactNode> = {
  success: <FiCheckCircle />,
  info: <FiInfo />,
  warning: <FiAlertTriangle />,
  error: <FiXCircle />,
};

export const ToastViewport: React.FC<ToastViewportProps> = ({ messages, onDismiss }) => (
  <div className="toast-viewport" aria-live="polite" aria-atomic="false">
    {messages.map((toast) => (
      <div className={`toast toast--${toast.kind}`} key={toast.id} role={toast.kind === 'error' ? 'alert' : 'status'}>
        <span className="toast__icon" aria-hidden="true">{icons[toast.kind]}</span>
        <span className="toast__message">{toast.message}</span>
        {toast.actionLabel && toast.onAction && (
          <button className="toast__action" type="button" onClick={toast.onAction}>
            {toast.actionLabel}
          </button>
        )}
        <button className="toast__dismiss" type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
          <FiX />
        </button>
      </div>
    ))}
  </div>
);
