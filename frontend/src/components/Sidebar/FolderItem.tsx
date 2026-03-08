'use client';

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, FolderOpen, Folder as FolderIcon, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDroppable } from '@dnd-kit/core';
import type { Folder } from './SidebarProvider';
import { useSidebar } from './SidebarProvider';

interface SidebarItem {
  id: string;
  title: string;
  type: 'folder' | 'file';
}

interface FolderItemProps {
  folder: Folder;
  /** Meeting items that belong to this folder. */
  children: SidebarItem[];
  /** Whether the outer sidebar is in collapsed (icon-only) mode. */
  isSidebarCollapsed: boolean;
  /** Callback to render an individual meeting row — keeps rendering logic in Sidebar. */
  renderMeetingItem: (item: SidebarItem, insideFolder?: boolean) => React.ReactNode;
  /** Currently active meeting id, for highlight purposes. */
  activeMeetingId?: string;
}

export function FolderItem({
  folder,
  children,
  isSidebarCollapsed,
  renderMeetingItem,
  activeMeetingId,
}: FolderItemProps) {
  const router = useRouter();
  const { renameFolder, deleteFolder, setPendingFolderId } = useSidebar();

  // Expand/collapse state (local — doesn't need to survive remounts)
  const [isExpanded, setIsExpanded] = useState(true);

  // Inline rename state
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Hover state for showing action buttons
  const [isHovered, setIsHovered] = useState(false);

  // Make this folder a droppable target so meetings can be dragged into it
  const { setNodeRef, isOver } = useDroppable({ id: folder.id });

  // --- Rename handlers ---

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(folder.name);
    setIsRenaming(true);
    // Focus the input after React renders it
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  const commitRename = async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== folder.name) {
      try {
        await renameFolder(folder.id, trimmed);
      } catch (err) {
        console.error('Failed to rename folder:', err);
      }
    }
    setIsRenaming(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') {
      setRenameValue(folder.name);
      setIsRenaming(false);
    }
  };

  // --- Delete handler ---

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteFolder(folder.id);
    } catch (err) {
      console.error('Failed to delete folder:', err);
    }
  };

  // --- New meeting in folder ---

  const handleNewMeeting = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingFolderId(folder.id);
    router.push('/meeting-details?id=new');
  };

  // --- Collapsed sidebar: icon-only rendering ---

  if (isSidebarCollapsed) {
    return (
      <div
        ref={setNodeRef}
        title={folder.name}
        className={cn(
          'flex justify-center items-center w-8 h-8 rounded-md mx-auto my-1 transition-colors cursor-pointer',
          isOver ? 'bg-blue-500/20' : 'hover:bg-white/10',
        )}
      >
        <FolderIcon className="h-4 w-4 text-zinc-400" />
      </div>
    );
  }

  // --- Expanded sidebar: full rendering ---

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-md transition-colors',
        isOver && 'bg-blue-500/10 ring-1 ring-blue-500/30',
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Folder header row */}
      <div
        className="flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer select-none group"
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        {/* Collapse chevron */}
        <span className="text-zinc-500 flex-shrink-0">
          {isExpanded
            ? <ChevronDown className="h-3 w-3" />
            : <ChevronRight className="h-3 w-3" />}
        </span>

        {/* Folder icon */}
        <span className="text-zinc-400 flex-shrink-0">
          {isExpanded
            ? <FolderOpen className="h-3.5 w-3.5" />
            : <FolderIcon className="h-3.5 w-3.5" />}
        </span>

        {/* Folder name — or rename input */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="flex-1 bg-transparent text-sm text-white border-b border-blue-500 outline-none px-0.5"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleRenameKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="flex-1 text-sm font-medium text-zinc-200 truncate"
            onDoubleClick={startRename}
          >
            {folder.name}
          </span>
        )}

        {/* Meeting count badge */}
        {!isRenaming && (
          <span className="text-xs text-zinc-500 flex-shrink-0 ml-1">
            {children.length}
          </span>
        )}

        {/* Action buttons — visible on hover */}
        {isHovered && !isRenaming && (
          <div className="flex items-center gap-0.5 ml-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            {/* New meeting in this folder */}
            <button
              className="p-0.5 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors"
              title="New meeting in folder"
              onClick={handleNewMeeting}
            >
              <Plus className="h-3 w-3" />
            </button>
            {/* Delete folder */}
            <button
              className="p-0.5 rounded hover:bg-red-900/30 text-zinc-500 hover:text-red-400 transition-colors"
              title="Delete folder"
              onClick={handleDelete}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* Meeting children */}
      {isExpanded && children.length > 0 && (
        <div className="ml-4 border-l border-white/5">
          {children.map((item) => renderMeetingItem(item, true))}
        </div>
      )}
    </div>
  );
}
