import React from 'react';
import { Routes, Route } from 'react-router-dom';
import BrowsePage from './pages/BrowsePage';

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<BrowsePage />} />
      <Route path="*" element={<BrowsePage />} />
    </Routes>
  );
};

export default App;
