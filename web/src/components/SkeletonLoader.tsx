import React from 'react';
import './SkeletonLoader.css';

interface SkeletonLoaderProps {
  count?: number;
}

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({ count = 5 }) => {
  return (
    <div className="skeleton-list">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="skeleton-item">
          <div className="skeleton-cover" />
          <div className="skeleton-info">
            <div className="skeleton-title" />
            <div className="skeleton-artist" />
          </div>
          <div className="skeleton-action" />
        </div>
      ))}
    </div>
  );
};

export default SkeletonLoader;
