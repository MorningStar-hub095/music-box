#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据库初始化脚本
创建 music_box 数据库和所有必要的表结构

依赖:
    pip install mysql-connector-python bcrypt
"""

import os as _os
import sys as _sys

_SCRIPT_DIR = _os.path.dirname(_os.path.abspath(__file__))
_LOCAL_SITE = _os.path.join(_SCRIPT_DIR, "site-packages")
if _os.path.isdir(_LOCAL_SITE) and _LOCAL_SITE not in _sys.path:
    _sys.path.insert(0, _LOCAL_SITE)

try:
    import mysql.connector
    from mysql.connector import Error
    HAS_MYSQL = True
except ImportError:
    HAS_MYSQL = False
    print("错误: mysql-connector-python 未安装")
    print("请运行: pip install mysql-connector-python")

try:
    import bcrypt
    HAS_BCRYPT = True
except ImportError:
    HAS_BCRYPT = False
    print("警告: bcrypt 未安装，将使用预计算的密码哈希")

# admin123 的 bcrypt 哈希 (预计算)
ADMIN_PASSWORD_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'

def generate_password_hash(password):
    """生成 bcrypt 密码哈希"""
    if HAS_BCRYPT:
        return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    else:
        return ADMIN_PASSWORD_HASH

def init_database():
    """初始化MySQL数据库"""
    if not HAS_MYSQL:
        print("无法运行: mysql-connector-python 未安装")
        print("请先运行: pip install mysql-connector-python bcrypt")
        return False
    
    connection = None
    cursor = None
    
    # 尝试不同的密码连接
    passwords = [None, '', 'root', '123456', 'password']
    
    for password in passwords:
        try:
            print(f"尝试连接 MySQL (密码: {'无' if password is None or password == '' else '***'})...")
            
            connection = mysql.connector.connect(
                host='localhost',
                user='root',
                password=password if password else None
            )
            
            if connection.is_connected():
                print(f"连接成功！")
                break
                
        except Error as e:
            print(f"连接失败: {e}")
            connection = None
            continue
    
    if not connection or not connection.is_connected():
        print("无法连接到 MySQL 数据库，请检查：")
        print("1. MySQL 服务是否已启动")
        print("2. 用户名和密码是否正确")
        print("3. MySQL 是否允许本地连接")
        return False
    
    try:
        cursor = connection.cursor()
        
        # 创建数据库
        cursor.execute("""
            CREATE DATABASE IF NOT EXISTS music_box 
            CHARACTER SET utf8mb4 
            COLLATE utf8mb4_unicode_ci
        """)
        
        # 使用数据库
        cursor.execute("USE music_box")
        
        # 创建歌曲表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS songs (
                id VARCHAR(50) PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                artist VARCHAR(200) NOT NULL,
                album VARCHAR(200),
                album_cover VARCHAR(500),
                audio_url VARCHAR(500) NOT NULL,
                audio_url_mp3 VARCHAR(500),
                lyric_content TEXT,
                cover_color VARCHAR(20),
                platform VARCHAR(20),
                playable BOOLEAN DEFAULT TRUE,
                play_count INT DEFAULT 0,
                comment_count INT DEFAULT 0,
                like_count INT DEFAULT 0,
                favorite_count INT DEFAULT 0,
                hot_score FLOAT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                url_checked_at TIMESTAMP,
                INDEX idx_title (title),
                INDEX idx_artist (artist),
                INDEX idx_platform (platform),
                INDEX idx_hot_score (hot_score),
                INDEX idx_created_at (created_at)
            )
        """)
        
        # 创建流派表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS genres (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(50) NOT NULL,
                parent_id INT,
                level INT DEFAULT 1,
                sort_order INT DEFAULT 0,
                FOREIGN KEY (parent_id) REFERENCES genres(id)
            )
        """)
        
        # 创建语言表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS languages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(50) NOT NULL,
                code VARCHAR(10) UNIQUE
            )
        """)
        
        # 创建场景表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS scenes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(50) NOT NULL,
                icon VARCHAR(50)
            )
        """)
        
        # 创建情绪表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS moods (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(50) NOT NULL,
                icon VARCHAR(50)
            )
        """)
        
        # 创建年代表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS decades (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(20) NOT NULL,
                start_year INT,
                end_year INT
            )
        """)
        
        # 创建自定义标签表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tags (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(50) NOT NULL,
                parent_id INT,
                level INT DEFAULT 1,
                user_id INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (parent_id) REFERENCES tags(id)
            )
        """)
        
        # 创建歌曲-流派关联表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS song_genres (
                song_id VARCHAR(50),
                genre_id INT,
                PRIMARY KEY (song_id, genre_id),
                FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
                FOREIGN KEY (genre_id) REFERENCES genres(id)
            )
        """)
        
        # 创建歌曲-语言关联表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS song_languages (
                song_id VARCHAR(50),
                language_id INT,
                PRIMARY KEY (song_id, language_id),
                FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
                FOREIGN KEY (language_id) REFERENCES languages(id)
            )
        """)
        
        # 创建歌曲-场景关联表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS song_scenes (
                song_id VARCHAR(50),
                scene_id INT,
                PRIMARY KEY (song_id, scene_id),
                FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
                FOREIGN KEY (scene_id) REFERENCES scenes(id)
            )
        """)
        
        # 创建歌曲-情绪关联表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS song_moods (
                song_id VARCHAR(50),
                mood_id INT,
                PRIMARY KEY (song_id, mood_id),
                FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
                FOREIGN KEY (mood_id) REFERENCES moods(id)
            )
        """)
        
        # 创建歌曲-年代关联表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS song_decades (
                song_id VARCHAR(50),
                decade_id INT,
                PRIMARY KEY (song_id, decade_id),
                FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
                FOREIGN KEY (decade_id) REFERENCES decades(id)
            )
        """)
        
        # 创建歌曲-标签关联表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS song_tags (
                song_id VARCHAR(50),
                tag_id INT,
                PRIMARY KEY (song_id, tag_id),
                FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id)
            )
        """)
        
        # 创建用户表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role ENUM('super_admin', 'admin', 'editor', 'user') DEFAULT 'user',
                status ENUM('active', 'disabled') DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login_at TIMESTAMP,
                reset_token VARCHAR(255),
                reset_token_expires_at TIMESTAMP
            )
        """)
        
        # 创建操作日志表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS operation_logs (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                user_id INT,
                action VARCHAR(50) NOT NULL,
                target_type VARCHAR(50),
                target_id VARCHAR(50),
                details JSON,
                ip_address VARCHAR(45),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        
        # 创建爬取日志表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS crawl_logs (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                task_type VARCHAR(50) NOT NULL,
                platform VARCHAR(20),
                status ENUM('running', 'success', 'failed') DEFAULT 'running',
                total_count INT DEFAULT 0,
                success_count INT DEFAULT 0,
                failed_count INT DEFAULT 0,
                error_message TEXT,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP
            )
        """)
        
        # 生成管理员密码哈希
        admin_password = 'admin123'
        password_hash = generate_password_hash(admin_password)
        
        # 插入默认管理员用户（密码: admin123）
        cursor.execute("""
            INSERT IGNORE INTO users (username, email, password_hash, role) VALUES
            (%s, %s, %s, %s)
        """, ('admin', 'admin@example.com', password_hash, 'super_admin'))
        
        connection.commit()
        print("数据库初始化成功！")
        print("默认管理员账户: admin / admin123")
        return True
        
    except Error as e:
        print(f"数据库初始化失败: {e}")
        return False
        
    finally:
        if cursor:
            cursor.close()
        if connection and connection.is_connected():
            connection.close()

if __name__ == '__main__':
    init_database()