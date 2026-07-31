import React from 'react';
import { Topbar } from './components/Topbar';
import { Sidebar } from './components/Sidebar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { FloorplanCanvas } from './canvas/FloorplanCanvas';
import './App.css';

const App: React.FC = () => {
  return (
    <div className="app-container">
      <Topbar />
      <div className="main-content">
        <Sidebar />
        <FloorplanCanvas />
        <PropertiesPanel />
      </div>
    </div>
  );
};

export default App;
