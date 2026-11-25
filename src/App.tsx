import React from 'react';
import { Topbar } from './components/Topbar';
import { Sidebar } from './components/Sidebar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { VirtuosoCellViewBar, VirtuosoWorkspace } from './components/VirtuosoWorkspace';
import { ToastViewport } from './components/ToastViewport';
import { useStore } from './store/useStore';
import './App.css';

const App: React.FC = () => {
  const toasts = useStore((state) => state.toasts);
  const dismissToast = useStore((state) => state.dismissToast);
  return (
    <div className="app-container">
      <Topbar />
      <VirtuosoCellViewBar />
      <div className="main-content">
        <Sidebar />
        <VirtuosoWorkspace />
        <PropertiesPanel />
      </div>
      <ToastViewport messages={toasts} onDismiss={dismissToast} />
    </div>
  );
};

export default App;
