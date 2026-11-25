import React, { useEffect, useState } from 'react';
import { usersApi } from '../services/api';

interface User {
  id: number;
  username: string;
  role: string;
  status: string;
  createdAt: string;
}

const UsersPage: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editRole, setEditRole] = useState('');
  const [editStatus, setEditStatus] = useState('');

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await usersApi.getUsers();
      setUsers(res.data.data || res.data || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '获取用户列表失败';
      setError(errorMessage);
      console.error('[UsersPage] 获取用户列表失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setEditRole(user.role);
    setEditStatus(user.status);
  };

  const handleCancelEdit = () => {
    setEditingUser(null);
    setEditRole('');
    setEditStatus('');
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;
    try {
      await usersApi.updateUser(editingUser.id, {
        role: editRole,
        status: editStatus,
      });
      setEditingUser(null);
      fetchUsers();
    } catch (err) {
      alert('更新用户失败');
      console.error('[UsersPage] 更新用户失败:', err);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此用户吗？')) return;
    try {
      await usersApi.deleteUser(id);
      fetchUsers();
    } catch (err) {
      alert('删除用户失败');
      console.error('[UsersPage] 删除用户失败:', err);
    }
  };

  if (loading) {
    return <div className="page-loading">加载中...</div>;
  }

  if (error) {
    return (
      <div className="users-page">
        <h2 className="page-title">用户管理</h2>
        <div className="error-state">
          <div className="error-icon">⚠️</div>
          <div className="error-message">{error}</div>
          <button className="retry-btn" onClick={fetchUsers}>
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="users-page">
      <h2 className="page-title">用户管理</h2>
      
      {/* 编辑用户弹窗 */}
      {editingUser && (
        <div className="modal-overlay">
          <div className="modal">
            <h3 className="modal-title">编辑用户: {editingUser.username}</h3>
            <div className="modal-form">
              <div className="form-group">
                <label>角色:</label>
                <select value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                  <option value="user">普通用户</option>
                  <option value="editor">编辑</option>
                  <option value="admin">管理员</option>
                  <option value="super_admin">超级管理员</option>
                </select>
              </div>
              <div className="form-group">
                <label>状态:</label>
                <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                  <option value="active">已激活</option>
                  <option value="pending">待审核</option>
                  <option value="disabled">已禁用</option>
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={handleCancelEdit}>取消</button>
              <button className="save-btn" onClick={handleSaveEdit}>保存</button>
            </div>
          </div>
        </div>
      )}
      
      <div className="users-table">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>用户名</th>
              <th>角色</th>
              <th>状态</th>
              <th>注册时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.id}</td>
                <td>{user.username}</td>
                <td>{user.role}</td>
                <td>
                  <span className={`status ${user.status}`}>
                    {user.status === 'active' ? '已激活' : user.status === 'pending' ? '待审核' : '已禁用'}
                  </span>
                </td>
                <td>{user.createdAt}</td>
                <td>
                  <div className="action-buttons">
                    <button className="action-btn" onClick={() => handleEdit(user)}>编辑</button>
                    <button className="delete-btn" onClick={() => handleDelete(user.id)}>删除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default UsersPage;
