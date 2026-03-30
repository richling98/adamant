'use client';

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, FolderOpen, Folder as FolderIcon, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDroppable } from '@dnd-kit/core';
import { invoke } from '@tauri-apps/api/core';
import type { Folder } from './SidebarProvider';
import { useSidebar } from './SidebarProvider';

interface SidebarItem {
  id: string;
  title: string;
  type: 'folder' | 'file';
  children?: SidebarItem[];
  folderData?: Folder;
}

interface FolderItemProps {
  folder: Folder;
  /** All direct children of this folder (subfolders + meetings). */
  children: SidebarItem[];
  /** Whether the outer sidebar is in collapsed (icon-only) mode. */
  isSidebarCollapsed: boolean;
  /** Callback to render an individual meeting row — keeps rendering logic in Sidebar. */
  renderMeetingItem: (item: SidebarItem, insideFolder?: boolean) => React.ReactNode;
  /** Currently active meeting id, for highlight purposes. */
  activeMeetingId?: string;
  /** Nesting depth — 0 for top-level folders, +1 per level. */
  depth?: number;
}

export function FolderItem({
  folder,
  children,
  isSidebarCollapsed,
  renderMeetingItem,
  activeMeetingId,
  depth = 0,
}: FolderItemProps) {
  const router = useRouter();
  const { renameFolder, deleteFolder, moveMeetingToFolder, createFolder } = useSidebar();

  // Expand/collapse state — persisted to localStorage so it survives app restarts.
  // Key is unique per folder so each folder remembers its own state independently.
  const STORAGE_KEY = `sidebar-folder-collapsed-${folder.id}`;
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      // Default to expanded (true) if no value has been saved yet
      return stored === null ? true : stored !== 'true' ? false : true;
    } catch {
      return true;
    }
  });

  const toggleExpanded = () => {
    setIsExpanded((prev) => {
      const next = !prev;
      try { localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
      return next;
    });
  };

  // Inline rename state
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Hover state for showing action buttons
  const [isHovered, setIsHovered] = useState(false);

  // Loading guard — prevents double-creation if the user clicks rapidly
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingSubfolder, setIsCreatingSubfolder] = useState(false);

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

  // Builds the default note title: e.g. "3-23-26 new note"
  const newNoteTitle = () => {
    const now = new Date();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    const yy = String(now.getFullYear()).slice(-2);
    return `${m}-${d}-${yy} new note`;
  };

  // Eagerly creates a note in the DB, assigns it to this folder, and navigates
  // directly to its real URL — no lazy ?id=new draft flow required.
  const handleNewMeeting = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCreating) return;
    setIsCreating(true);
    try {
      const meeting = await invoke<{ id: string }>('api_create_meeting', {
        title: newNoteTitle(),
      });
      // moveMeetingToFolder assigns to folder AND refreshes folders + meetings list
      await moveMeetingToFolder(meeting.id, folder.id);
      router.push(`/meeting-details?id=${meeting.id}`);
    } catch (err) {
      console.error('Failed to create meeting in folder:', err);
    } finally {
      setIsCreating(false);
    }
  };

  // --- New subfolder ---

  const handleNewSubfolder = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCreatingSubfolder) return;
    setIsCreatingSubfolder(true);
    try {
      await createFolder('New Folder', folder.id);
      // Expand so the new subfolder is immediately visible
      setIsExpanded(true);
      try { localStorage.setItem(STORAGE_KEY, 'true'); } catch {}
    } catch (err) {
      console.error('Failed to create subfolder:', err);
    } finally {
      setIsCreatingSubfolder(false);
    }
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
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={toggleExpanded}
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
            {/* Rename folder */}
            <button
              className="p-0.5 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors"
              title="Rename folder"
              onClick={startRename}
            >
              <Pencil className="h-3 w-3" />
            </button>
            {/* New subfolder inside this folder */}
            <button
              className="p-0.5 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="New subfolder"
              disabled={isCreatingSubfolder}
              onClick={handleNewSubfolder}
            >
              <FolderPlus className="h-3 w-3" />
            </button>
            {/* New meeting in this folder — disabled while creation is in flight */}
            <button
              className="p-0.5 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="New meeting in folder"
              disabled={isCreating}
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

      {/* Children — subfolders and meetings — hidden when collapsed */}
      <div className={cn(
        'overflow-hidden transition-all duration-200',
        isExpanded ? 'max-h-[9999px] opacity-100' : 'max-h-0 opacity-0',
      )}>
        {children.length > 0 && (
          <div className="ml-4 border-l border-white/5">
            {children.map((item) => {
              if (item.type === 'folder' && item.folderData) {
                return (
                  <FolderItem
                    key={item.id}
                    folder={item.folderData}
                    children={item.children ?? []}
                    isSidebarCollapsed={isSidebarCollapsed}
                    renderMeetingItem={renderMeetingItem}
                    activeMeetingId={activeMeetingId}
                    depth={depth + 1}
                  />
                );
              }
              return renderMeetingItem(item, true);
            })}
          </div>
        )}
      </div>
    </div>
  );
}
