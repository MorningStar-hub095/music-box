import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import StatsPage from './pages/StatsPage';
import SongsPage from './pages/SongsPage';
import SongDetailPage from './pages/SongDetailPage';
import GenresPage from './pages/GenresPage';
import UsersPage from './pages/UsersPage';
import PlaylistsPage from './pages/PlaylistsPage';
import CrawlerPage from './pages/CrawlerPage';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = localStorage.getItem('admin_token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<StatsPage />} />
        <Route path="songs" element={<SongsPage />} />
        <Route path="songs/:id" element={<SongDetailPage />} />
        <Route path="genres" element={<GenresPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="playlists" element={<PlaylistsPage />} />
        <Route path="crawler" element={<CrawlerPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;
