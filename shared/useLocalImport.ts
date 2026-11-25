// shared/useLocalImport.ts - 本地文件导入 Hook（Web 版本）
import { useState, useCallback, useRef } from 'react';
import { Track } from './types';

const IMPORT_COLORS = ['#17C3B2', '#8B5CF6', '#F59E0B', '#E76F51', '#2A9D8F', '#F4A261'];

export function useLocalImport(onImport: (track: Track) => void) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const importFiles = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.click();
    }
  }, []);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(f =>
      f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|ogg|flac|m4a)$/i)
    );

    fileArray.forEach((file, idx) => {
      const url = URL.createObjectURL(file);
      const name = file.name.replace(/\.[^.]+$/, '');
      const track: Track = {
        id: `local:${Date.now()}:${idx}`,
        title: name,
        artist: '本地文件',
        audioUrl: url,
        lyricContent: '[00:00.00]♪ 本地文件',
        coverColor: IMPORT_COLORS[Math.floor(Math.random() * IMPORT_COLORS.length)],
      };
      onImport(track);
    });
  }, [onImport]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  return {
    inputRef,
    dragOver,
    importFiles,
    handleFiles,
    onDrop,
    onDragOver,
    onDragLeave,
  };
}
