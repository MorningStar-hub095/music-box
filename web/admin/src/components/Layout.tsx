import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

const menuItems = [
  { path: '/', label: '数据统计', icon: '📊' },
  { path: '/songs', label: '歌曲管理', icon: '🎵' },
  { path: '/genres', label: '流派管理', icon: '🏷️' },
  { path: '/users', label: '用户管理', icon: '👥' },
  { path: '/playlists', label: '播放列表', icon: '📋' },
  { path: '/crawler', label: '爬虫管理', icon: '🕷️' },
];

const Layout: React.FC = () => {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    navigate('/login');
  };

  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-icon">🎶</span>
          <span className="logo-text">音乐盒子</span>
          <span className="logo-sub">管理后台</span>
        </div>
        <nav className="sidebar-nav">
          {menuItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `nav-item ${isActive ? 'active' : ''}`
              }
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="logout-btn" onClick={handleLogout}>
            退出登录
          </button>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
