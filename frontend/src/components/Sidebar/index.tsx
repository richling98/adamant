'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight, File, Settings, ChevronLeftCircle, ChevronRightCircle, Calendar, StickyNote, Home, Trash2, Plus, Search, Pencil, NotebookPen, SearchIcon, X, FolderPlus, Square, CheckSquare, Folder as FolderIcon, FolderOpen, ListTodo } from 'lucide-react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useSidebar } from './SidebarProvider';
import type { CurrentMeeting } from '@/components/Sidebar/SidebarProvider';
import { FolderItem } from './FolderItem';
import { closestCenter, DndContext, useDroppable, useDraggable, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { CollisionDetection, DragEndEvent, DragMoveEvent, DragStartEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  getFolderDropProjection,
  getMovedRectCenter,
  type FolderDropProjection,
  type FolderProjectionRow,
  type FolderRowRect,
  type PointerPosition,
} from './folderDndProjection';
import { ConfirmationModal } from '../ConfirmationModel/confirmation-modal';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { SettingTabs } from '../SettingTabs';
import { TranscriptModelProps } from '@/components/TranscriptSettings';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { VisuallyHidden } from "@/components/ui/visually-hidden"

import { MessageToast } from '../MessageToast';
import Logo from '../Logo';
import { ComplianceNotification } from '../ComplianceNotification';
import { Input } from '../ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../ui/input-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { useConfig } from '@/contexts/ConfigContext';
import { THEME_OPTIONS, type ThemeName } from '@/lib/theme';

interface SidebarItem {
  id: string;
  title: string;
  type: 'folder' | 'file';
  children?: SidebarItem[];
  folderData?: import('./SidebarProvider').Folder;
}

interface SearchResultSidebarItem extends SidebarItem {
  matchContext?: string;
  matchSource?: string;
}

const folderTreeId = (folderId: string) => `folder-tree:${folderId}`;
const folderRootBottomId = 'folder-tree:root-bottom';

type FolderRow = FolderProjectionRow & {
  folder: import('./SidebarProvider').Folder;
};

type FolderListNode =
  | { type: 'folder'; row: FolderRow }
  | { type: 'meeting'; meeting: CurrentMeeting; depth: number };

function debugFolderDnd(action: string, details: Record<string, unknown>) {
  try {
    if (window.localStorage.getItem('adamant-debug-folder-dnd') === 'true') {
      console.debug('[folder-dnd]', action, details);
    }
  } catch {
    // Debug-only logging should never affect drag behavior.
  }
}

const Sidebar: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentMeeting,
    setCurrentMeeting,
    sidebarItems,
    isCollapsed,
    toggleCollapse,
    searchTranscripts,
    searchResults,
    isSearching,
    meetings,
    setMeetings,
    serverAddress,
    folders,
    createFolder,
    renameFolder,
    deleteFolder,
    moveFolderToPosition,
    moveMeetingToFolder,
    refetchMeetings,
    todoDates,
  } = useSidebar();
  const { uiTheme, setUiTheme } = useConfig();
  const searchParams = useSearchParams();
  const activeTodoDate = searchParams.get('date');

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['meetings']));
  const [searchQuery, setSearchQuery] = useState<string>('');
  const isSearchMode = searchQuery.trim().length > 0;
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: 'ollama',
    model: '',
    whisperModel: '',
    apiKey: null,
    hasApiKey: false,
    ollamaEndpoint: null
  });
  const [transcriptModelConfig, setTranscriptModelConfig] = useState<TranscriptModelProps>({
    provider: 'parakeet',
    model: 'parakeet-tdt-0.6b-v3-int8',
    hasApiKey: true,
  });
  const [settingsSaveSuccess, setSettingsSaveSuccess] = useState<boolean | null>(null);

  // State for edit modal
  const [editModalState, setEditModalState] = useState<{ isOpen: boolean; meetingId: string | null; currentTitle: string }>({
    isOpen: false,
    meetingId: null,
    currentTitle: ''
  });
  const [editingTitle, setEditingTitle] = useState<string>('');

  // Button hover states for glass effect animations
  const [hoverCollapsedSettings, setHoverCollapsedSettings] = useState(false);
  const [hoverExpandedSettings, setHoverExpandedSettings] = useState(false);
  // Collapse state for the "Meeting Notes" unfiled section — persisted across restarts
  const [isMeetingNotesExpanded, setIsMeetingNotesExpanded] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('sidebar-meeting-notes-collapsed');
      return stored === null ? true : stored !== 'true' ? false : true;
    } catch {
      return true;
    }
  });
  const toggleMeetingNotes = () => {
    setIsMeetingNotesExpanded((prev) => {
      const next = !prev;
      try { localStorage.setItem('sidebar-meeting-notes-collapsed', String(next)); } catch {}
      return next;
    });
  };
  // Collapse state for the "Folders" section — persisted across restarts
  const [isFoldersExpanded, setIsFoldersExpanded] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('sidebar-folders-collapsed');
      return stored === null ? true : stored !== 'true' ? false : true;
    } catch {
      return true;
    }
  });
  const toggleFolders = () => {
    setIsFoldersExpanded((prev) => {
      const next = !prev;
      try { localStorage.setItem('sidebar-folders-collapsed', String(next)); } catch {}
      return next;
    });
  };
  // Collapse state for the "To Do's" section — persisted across restarts
  const [isTodosExpanded, setIsTodosExpanded] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('sidebar-todos-collapsed');
      return stored === null ? true : stored !== 'true' ? false : true;
    } catch {
      return true;
    }
  });
  const toggleTodos = () => {
    setIsTodosExpanded((prev) => {
      const next = !prev;
      try { localStorage.setItem('sidebar-todos-collapsed', String(next)); } catch {}
      return next;
    });
  };
  // Collapse state for the "By Date" section — persisted across restarts
  const [isByDateExpanded, setIsByDateExpanded] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('sidebar-by-date-collapsed');
      return stored === null ? true : stored !== 'true' ? false : true;
    } catch {
      return true;
    }
  });
  const toggleByDate = () => {
    setIsByDateExpanded((prev) => {
      const next = !prev;
      try { localStorage.setItem('sidebar-by-date-collapsed', String(next)); } catch {}
      return next;
    });
  };
  // Per-date-group collapse state — keyed by date label, stored in localStorage.
  // Date groups default to collapsed so the list stays compact on first load.
  const isDateGroupStoredExpanded = useCallback((dateLabel: string): boolean => {
    try {
      return localStorage.getItem(`sidebar-by-date-group-${dateLabel}`) === 'true';
    } catch {
      return false;
    }
  }, []);
  const [expandedDateGroups, setExpandedDateGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpandedDateGroups((prev) => {
      const next = new Set(prev);
      let changed = false;

      for (const meeting of meetings) {
        if (!meeting.created_at) continue;

        const date = new Date(meeting.created_at);
        const dateLabel = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;

        if (isDateGroupStoredExpanded(dateLabel) && !next.has(dateLabel)) {
          next.add(dateLabel);
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [meetings, isDateGroupStoredExpanded]);

  const toggleDateGroup = (dateLabel: string) => {
    setExpandedDateGroups((prev) => {
      const next = new Set(prev);
      const shouldExpand = !next.has(dateLabel);

      if (shouldExpand) {
        next.add(dateLabel);
      } else {
        next.delete(dateLabel);
      }

      try { localStorage.setItem(`sidebar-by-date-group-${dateLabel}`, String(shouldExpand)); } catch {}
      return next;
    });
  };

  // Loading guard for unfiled note creation — prevents double-creation on rapid clicks
  const [isCreatingUnfiled, setIsCreatingUnfiled] = useState(false);

  // New folder creation inline state
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const [folderExpansion, setFolderExpansion] = useState<Record<string, boolean>>({});
  const [folderDropProjection, setFolderDropProjection] = useState<FolderDropProjection | null>(null);
  const [meetingDropFolderId, setMeetingDropFolderId] = useState<string | null>(null);
  const folderRowRefs = useRef(new Map<string, HTMLDivElement>());
  const meetingRowRefs = useRef(new Map<string, HTMLDivElement>());
  const folderDragRowRectsRef = useRef<Map<string, FolderRowRect> | null>(null);
  const activeDragRectRef = useRef<FolderRowRect | null>(null);

  // Require 8px of movement before drag activates — prevents click events from
  // briefly triggering drop-zone highlights (blue flash on meeting row clicks).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    setFolderExpansion((prev) => {
      const next: Record<string, boolean> = {};
      for (const folder of folders) {
        if (Object.prototype.hasOwnProperty.call(prev, folder.id)) {
          next[folder.id] = prev[folder.id];
          continue;
        }

        try {
          const stored = localStorage.getItem(`sidebar-folder-collapsed-${folder.id}`);
          next[folder.id] = stored === null ? true : stored === 'true';
        } catch {
          next[folder.id] = true;
        }
      }
      return next;
    });
  }, [folders]);

  const isFolderExpanded = useCallback((folderId: string) => {
    return folderExpansion[folderId] ?? true;
  }, [folderExpansion]);

  const setFolderExpanded = useCallback((folderId: string, expanded: boolean) => {
    setFolderExpansion((prev) => ({ ...prev, [folderId]: expanded }));
    try { localStorage.setItem(`sidebar-folder-collapsed-${folderId}`, String(expanded)); } catch {}
  }, []);

  const sortedFolders = useMemo(() => {
    return [...folders].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  }, [folders]);

  const foldersByParent = useMemo(() => {
    const map = new Map<string | null, typeof folders>();
    for (const folder of sortedFolders) {
      const parentId = folder.parent_id ?? null;
      const siblings = map.get(parentId) ?? [];
      siblings.push(folder);
      map.set(parentId, siblings);
    }
    return map;
  }, [sortedFolders]);

  const folderSiblingIdsByParent = useMemo(() => {
    return new Map(
      Array.from(foldersByParent.entries()).map(([parentId, siblingFolders]) => [
        parentId,
        siblingFolders.map((folder) => folder.id),
      ]),
    );
  }, [foldersByParent]);

  const meetingsByFolder = useMemo(() => {
    const map = new Map<string, CurrentMeeting[]>();
    for (const meeting of meetings) {
      if (!meeting.folder_id) continue;
      const folderMeetings = map.get(meeting.folder_id) ?? [];
      folderMeetings.push(meeting);
      map.set(meeting.folder_id, folderMeetings);
    }
    return map;
  }, [meetings]);

  const folderRows = useMemo(() => {
    const rows: FolderRow[] = [];
    const visit = (parentId: string | null, depth: number, ancestorIds: string[]) => {
      const siblings = foldersByParent.get(parentId) ?? [];
      for (const folder of siblings) {
        const row: FolderRow = {
          id: folder.id,
          folder,
          parentId,
          depth,
          ancestorIds,
        };
        rows.push(row);
        if (isFolderExpanded(folder.id)) {
          visit(folder.id, depth + 1, [...ancestorIds, folder.id]);
        }
      }
    };
    visit(null, 0, []);
    return rows;
  }, [foldersByParent, isFolderExpanded]);

  const folderTreeNodes = useMemo(() => {
    const nodes: FolderListNode[] = [];
    const visit = (parentId: string | null, depth: number, ancestorIds: string[]) => {
      const siblings = foldersByParent.get(parentId) ?? [];
      for (const folder of siblings) {
        const row: FolderRow = {
          id: folder.id,
          folder,
          parentId,
          depth,
          ancestorIds,
        };
        nodes.push({ type: 'folder', row });
        if (isFolderExpanded(folder.id)) {
          visit(folder.id, depth + 1, [...ancestorIds, folder.id]);
          for (const meeting of meetingsByFolder.get(folder.id) ?? []) {
            nodes.push({ type: 'meeting', meeting, depth: depth + 1 });
          }
        }
      }
    };
    visit(null, 0, []);
    return nodes;
  }, [foldersByParent, isFolderExpanded, meetingsByFolder]);

  const clearFolderDragState = useCallback(() => {
    setFolderDropProjection(null);
    setMeetingDropFolderId(null);
    folderDragRowRectsRef.current = null;
    activeDragRectRef.current = null;
  }, []);

  const folderCollisionDetection = useCallback<CollisionDetection>((args) => {
    const activeType = args.active.data.current?.type;
    if (activeType !== 'folder-tree-row') {
      return closestCenter(args);
    }

    const folderContainers = args.droppableContainers.filter((container) => {
      const type = container.data.current?.type;
      return type === 'folder-tree-row' || type === 'folder-root-bottom';
    });

    return closestCenter({ ...args, droppableContainers: folderContainers });
  }, []);

  const setFolderRowRef = useCallback((folderId: string, node: HTMLDivElement | null) => {
    if (node) {
      folderRowRefs.current.set(folderId, node);
    } else {
      folderRowRefs.current.delete(folderId);
    }
  }, []);

  const setMeetingRowRef = useCallback((meetingId: string, node: HTMLDivElement | null) => {
    if (node) {
      meetingRowRefs.current.set(meetingId, node);
    } else {
      meetingRowRefs.current.delete(meetingId);
    }
  }, []);

  const domRectToFolderRect = useCallback((rect: DOMRect): FolderRowRect => ({
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    width: rect.width,
    height: rect.height,
  }), []);

  const getFolderRowRects = useCallback(() => {
    const rowRects = new Map<string, FolderRowRect>();
    for (const [folderId, node] of folderRowRefs.current.entries()) {
      const rect = node.getBoundingClientRect();
      rowRects.set(folderId, domRectToFolderRect(rect));
    }
    return rowRects;
  }, [domRectToFolderRect]);

  const getDragVisualCenter = useCallback((delta: { x: number; y: number }): PointerPosition | null => {
    const activeRect = activeDragRectRef.current;
    if (!activeRect) {
      return null;
    }

    return getMovedRectCenter(activeRect, delta);
  }, []);

  const projectFolderDrop = useCallback((activeFolderId: string, pointer: PointerPosition | null) => {
    if (!pointer) return null;

    return getFolderDropProjection({
      activeFolderId,
      pointer,
      rows: folderRows,
      rowRects: folderDragRowRectsRef.current ?? getFolderRowRects(),
      siblingIdsByParent: folderSiblingIdsByParent,
    });
  }, [folderRows, folderSiblingIdsByParent, getFolderRowRects]);

  const getFolderIdAtVisualCenter = useCallback((center: PointerPosition | null) => {
    if (!center) return null;

    const rowRects = folderDragRowRectsRef.current ?? getFolderRowRects();
    for (const row of folderRows) {
      const rect = rowRects.get(row.id);
      if (!rect) continue;
      if (center.y >= rect.top && center.y <= rect.bottom) {
        return row.id;
      }
    }

    return null;
  }, [folderRows, getFolderRowRects]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    clearFolderDragState();
    const dragType = event.active.data.current?.type;
    const isFolderDrag = dragType === 'folder-tree-row';
    const isMeetingDrag = dragType === 'meeting';
    const folderRects = getFolderRowRects();
    folderDragRowRectsRef.current = isFolderDrag || isMeetingDrag ? folderRects : null;

    if (isFolderDrag) {
      const folderId = event.active.data.current?.folderId;
      activeDragRectRef.current = typeof folderId === 'string' ? folderRects.get(folderId) ?? null : null;
    } else if (isMeetingDrag) {
      const meetingId = event.active.data.current?.meetingId;
      const meetingNode = typeof meetingId === 'string' ? meetingRowRefs.current.get(meetingId) : null;
      activeDragRectRef.current = meetingNode ? domRectToFolderRect(meetingNode.getBoundingClientRect()) : null;
    } else {
      activeDragRectRef.current = null;
    }
  }, [clearFolderDragState, domRectToFolderRect, getFolderRowRects]);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const activeData = event.active.data.current as { type?: string; folderId?: string } | undefined;
    const center = getDragVisualCenter(event.delta);

    if (activeData?.type === 'folder-tree-row' && activeData.folderId) {
      const projection = projectFolderDrop(activeData.folderId, center);
      setFolderDropProjection(projection);
      setMeetingDropFolderId(null);
      debugFolderDnd('project-folder-drop', {
        folderId: activeData.folderId,
        dragVisualCenter: center,
        projection,
      });
      return;
    }

    if (activeData?.type === 'meeting') {
      setFolderDropProjection(null);
      setMeetingDropFolderId(getFolderIdAtVisualCenter(center));
    }
  }, [getDragVisualCenter, getFolderIdAtVisualCenter, projectFolderDrop]);

  // Handle drag-and-drop for meetings and folders.
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    const activeData = active.data.current as
      | { type: 'meeting'; meetingId: string }
      | { type: 'folder-tree-row'; folderId: string }
      | undefined;
    const overData = over?.data.current as
      | { type: 'folder-tree-row'; folderId: string }
      | { type: 'folder-root-bottom' }
      | { type: 'meeting-root-target' }
      | undefined;

    if (!activeData) return;

    try {
      if (activeData.type === 'meeting') {
        const targetFolderId = meetingDropFolderId ?? getFolderIdAtVisualCenter(getDragVisualCenter(event.delta));
        clearFolderDragState();
        if (targetFolderId) {
          await moveMeetingToFolder(activeData.meetingId, targetFolderId);
          return;
        }

        if (!over) return;
        if (!overData) return;
        if (overData.type === 'meeting-root-target') {
          await moveMeetingToFolder(activeData.meetingId, null);
        }
        return;
      }

      const projection = projectFolderDrop(activeData.folderId, getDragVisualCenter(event.delta)) ?? folderDropProjection;
      clearFolderDragState();
      if (activeData.type === 'folder-tree-row' && projection) {
        const currentFolder = folders.find((folder) => folder.id === activeData.folderId);
        if ((currentFolder?.parent_id ?? null) === projection.parentId) {
          const currentSiblings = foldersByParent.get(projection.parentId) ?? [];
          const currentIndex = currentSiblings.findIndex((folder) => folder.id === activeData.folderId);
          if (currentIndex === projection.positionIndex) return;
        }

        debugFolderDnd('move-folder-tree-row', {
          folderId: activeData.folderId,
          overId: over?.id,
          overType: overData?.type,
          dropType: projection.type,
          parentId: projection.parentId,
          positionIndex: projection.positionIndex,
        });
        await moveFolderToPosition(activeData.folderId, projection.parentId, projection.positionIndex);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message || 'Failed to move item');
    }
  }, [clearFolderDragState, folderDropProjection, folders, foldersByParent, getDragVisualCenter, getFolderIdAtVisualCenter, meetingDropFolderId, moveFolderToPosition, moveMeetingToFolder, projectFolderDrop]);

  const handleDragCancel = useCallback(() => {
    clearFolderDragState();
  }, [clearFolderDragState]);

  // Commit a new folder name from the inline input
  const commitNewFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (name) {
      try {
        await createFolder(name);
      } catch (err) {
        console.error('Failed to create folder:', err);
      }
    }
    setNewFolderName('');
    setIsCreatingFolder(false);
  }, [newFolderName, createFolder]);

  // Ensure 'meetings' folder is always expanded
  useEffect(() => {
    if (!expandedFolders.has('meetings')) {
      const newExpanded = new Set(expandedFolders);
      newExpanded.add('meetings');
      setExpandedFolders(newExpanded);
    }
  }, [expandedFolders]);

  // useEffect(() => {
  //   if (settingsSaveSuccess !== null) {
  //     const timer = setTimeout(() => {
  //       setSettingsSaveSuccess(null);
  //     }, 3000);
  //   }
  // }, [settingsSaveSuccess]);


  const [deleteModalState, setDeleteModalState] = useState<{ isOpen: boolean; itemId: string | null }>({ isOpen: false, itemId: null });
  const [dateDeleteModalState, setDateDeleteModalState] = useState<{
    isOpen: boolean;
    dateLabel: string | null;
    meetingIds: string[];
  }>({ isOpen: false, dateLabel: null, meetingIds: [] });

  // ── Multi-select deletion state ──────────────────────────────────────────
  // Tracks the set of meeting IDs the user has check-selected for bulk delete.
  const [selectedMeetingIds, setSelectedMeetingIds] = useState<Set<string>>(new Set());
  // Controls the bulk-delete confirmation modal
  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false);

  // Toggle a single meeting in/out of the selection set
  const toggleMeetingSelection = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // prevent row click from navigating
    setSelectedMeetingIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleDateSelection = useCallback((meetingIds: string[], e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedMeetingIds(prev => {
      const next = new Set(prev);
      const allSelected = meetingIds.length > 0 && meetingIds.every((id) => next.has(id));

      if (allSelected) {
        meetingIds.forEach((id) => next.delete(id));
      } else {
        meetingIds.forEach((id) => next.add(id));
      }

      return next;
    });
  }, []);

  // Clear all selections
  const clearSelection = useCallback(() => setSelectedMeetingIds(new Set()), []);

  // Clear selection on Escape key press
  useEffect(() => {
    if (selectedMeetingIds.size === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedMeetingIds.size, clearSelection]);

  useEffect(() => {
    // Note: Don't set hardcoded defaults - let DB be the source of truth
    const fetchModelConfig = async () => {
      // Only make API call if serverAddress is loaded
      if (!serverAddress) {
        console.debug('Waiting for server address to load before fetching model config');
        return;
      }

      try {
        const data = await invoke('api_get_model_config') as any;
        if (data && data.provider !== null) {
          setModelConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch model config:', error);
      }
    };

    fetchModelConfig();
  }, [serverAddress]);


  useEffect(() => {
    // Note: Don't set hardcoded defaults - let DB be the source of truth
    const fetchTranscriptSettings = async () => {
      // Only make API call if serverAddress is loaded
      if (!serverAddress) {
        console.debug('Waiting for server address to load before fetching transcript settings');
        return;
      }

      try {
        const data = await invoke('api_get_transcript_config') as any;
        if (data && data.provider !== null) {
          data.apiKey = null;
          setTranscriptModelConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch transcript settings:', error);
      }
    };
    fetchTranscriptSettings();
  }, [serverAddress]);

  // Listen for model config updates from other components
  useEffect(() => {
    const setupListener = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<ModelConfig>('model-config-updated', (event) => {
        console.debug('Sidebar received model-config-updated event:', event.payload);
        setModelConfig(event.payload);
      });

      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then(fn => cleanup = fn);

    return () => {
      cleanup?.();
    };
  }, []);



  // Handle model config save
  const handleSaveModelConfig = async (config: ModelConfig) => {
    try {
      await invoke('api_save_model_config', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey ?? null,
        ollamaEndpoint: config.ollamaEndpoint,
      });

      const savedConfig = { ...config, apiKey: null };
      setModelConfig(savedConfig);
      console.debug('Model config saved successfully');
      setSettingsSaveSuccess(true);

      // Emit event to sync other components
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', savedConfig);

      // Track settings change
      await Analytics.trackSettingsChanged('model_config', `${config.provider}_${config.model}`);
    } catch (error) {
      console.error('Error saving model config:', error);
      setSettingsSaveSuccess(false);
    }
  };

  const handleSaveTranscriptConfig = async (updatedConfig?: TranscriptModelProps) => {
    try {
      const configToSave = updatedConfig || transcriptModelConfig;
      const payload = {
        provider: configToSave.provider,
        model: configToSave.model,
        apiKey: configToSave.apiKey ?? null
      };
      console.debug('Saving transcript config with payload:', payload);

      await invoke('api_save_transcript_config', {
        provider: payload.provider,
        model: payload.model,
        apiKey: payload.apiKey,
      });


      setSettingsSaveSuccess(true);

      // Track settings change
      const transcriptConfigToSave = updatedConfig || transcriptModelConfig;
      await Analytics.trackSettingsChanged('transcript_config', `${transcriptConfigToSave.provider}_${transcriptConfigToSave.model}`);
    } catch (error) {
      console.error('Failed to save transcript config:', error);
      setSettingsSaveSuccess(false);
    }
  };

  // Handle search input changes
  const handleSearchChange = useCallback(async (value: string) => {
    setSearchQuery(value);

    // If search query is empty, just return to normal view
    if (!value.trim()) {
      await searchTranscripts('');
      return;
    }

    // Search through transcripts
    await searchTranscripts(value);

  }, [searchTranscripts]);

  const searchResultItems = useMemo<SearchResultSidebarItem[]>(() => {
    if (!isSearchMode) return [];

    const seen = new Set<string>();
    const meetingsById = new Map(meetings.map((meeting) => [meeting.id, meeting]));

    return searchResults
      .filter((result) => {
        if (!meetingsById.has(result.id)) return false;
        if (seen.has(result.id)) return false;
        seen.add(result.id);
        return true;
      })
      .map((result) => {
        const meeting = meetingsById.get(result.id);

        return {
          id: result.id,
          title: meeting?.title ?? result.title,
          type: 'file' as const,
          matchContext: result.matchContext,
          matchSource: result.matchSource,
        };
      });
  }, [isSearchMode, meetings, searchResults]);

  const folderSearchItems = useMemo<SidebarItem[]>(() => {
    if (!isSearchMode || !normalizedSearchQuery) return [];

    const matches: SidebarItem[] = [];
    const seen = new Set<string>();

    const visit = (items: SidebarItem[] = []) => {
      for (const item of items) {
        if (item.type === 'folder') {
          const folderName = item.folderData?.name ?? item.title;
          if (folderName.toLowerCase().includes(normalizedSearchQuery) && !seen.has(item.id)) {
            seen.add(item.id);
            matches.push(item);
          }
        }

        if (item.children?.length) {
          visit(item.children);
        }
      }
    };

    visit(sidebarItems);
    return matches;
  }, [isSearchMode, normalizedSearchQuery, sidebarItems]);


  const deleteMeetingIds = useCallback(async (idsToDelete: string[]) => {
    const successfulIds: string[] = [];
    let failureCount = 0;

    for (const id of idsToDelete) {
      try {
        await invoke('api_delete_meeting', { meetingId: id });
        Analytics.trackMeetingDeleted(id);
        successfulIds.push(id);
      } catch (error) {
        failureCount++;
        console.error(`Failed to delete meeting ${id}:`, error);
      }
    }

    if (successfulIds.length > 0) {
      setMeetings(meetings.filter((m: CurrentMeeting) => !successfulIds.includes(m.id)));

      setSelectedMeetingIds(prev => {
        const next = new Set(prev);
        successfulIds.forEach((id) => next.delete(id));
        return next;
      });

      if (currentMeeting?.id && successfulIds.includes(currentMeeting.id)) {
        setCurrentMeeting({ id: 'intro-call', title: '+ New Call' });
        router.push('/');
      }
    }

    return { successCount: successfulIds.length, failureCount };
  }, [currentMeeting?.id, meetings, router, setCurrentMeeting, setMeetings]);

  const handleDelete = async (itemId: string) => {
    console.debug('Deleting item:', itemId);
    const { successCount, failureCount } = await deleteMeetingIds([itemId]);

    if (successCount === 1) {
      console.debug('Meeting deleted successfully');
      toast.success("Meeting deleted successfully", {
        description: "All associated data has been removed"
      });
    } else if (failureCount > 0) {
      toast.error("Failed to delete meeting", {
        description: "Please try again."
      });
    }
  };

  const handleDeleteConfirm = () => {
    if (deleteModalState.itemId) {
      handleDelete(deleteModalState.itemId);
    }
    setDeleteModalState({ isOpen: false, itemId: null });
  };

  // Delete all currently-selected meetings sequentially, then clean up state
  const handleBulkDelete = async () => {
    const idsToDelete = Array.from(selectedMeetingIds);
    const { successCount, failureCount } = await deleteMeetingIds(idsToDelete);

    clearSelection();
    setBulkDeleteModalOpen(false);

    if (successCount > 0) {
      toast.success(`${successCount} meeting${successCount !== 1 ? 's' : ''} deleted`, {
        description: 'All associated data has been removed',
      });
    }

    if (failureCount > 0) {
      toast.error(`${failureCount} meeting${failureCount !== 1 ? 's' : ''} could not be deleted`);
    }
  };

  const handleDateDeleteConfirm = async () => {
    const { dateLabel, meetingIds } = dateDeleteModalState;
    const { successCount, failureCount } = await deleteMeetingIds(meetingIds);

    setDateDeleteModalState({ isOpen: false, dateLabel: null, meetingIds: [] });

    if (successCount > 0) {
      toast.success(`${successCount} meeting${successCount !== 1 ? 's' : ''} from ${dateLabel} deleted`, {
        description: 'All associated data has been removed',
      });
    }

    if (failureCount > 0) {
      toast.error(`${failureCount} meeting${failureCount !== 1 ? 's' : ''} from ${dateLabel} could not be deleted`);
    }
  };

  // Handle modal editing of meeting names
  const handleEditStart = (meetingId: string, currentTitle: string) => {
    setEditModalState({
      isOpen: true,
      meetingId: meetingId,
      currentTitle: currentTitle
    });
    setEditingTitle(currentTitle);
  };

  const handleEditConfirm = async () => {
    const newTitle = editingTitle.trim();
    const meetingId = editModalState.meetingId;

    if (!meetingId) return;

    // Prevent empty titles
    if (!newTitle) {
      toast.error("Meeting title cannot be empty");
      return;
    }

    try {
      await invoke('api_save_meeting_title', {
        meetingId: meetingId,
        title: newTitle,
      });

      // Update local state
      const updatedMeetings = meetings.map((m: CurrentMeeting) =>
        m.id === meetingId ? { ...m, title: newTitle } : m
      );
      setMeetings(updatedMeetings);

      // Update current meeting if it's the one being edited
      if (currentMeeting?.id === meetingId) {
        setCurrentMeeting({ id: meetingId, title: newTitle });
      }

      // Track the edit
      Analytics.trackButtonClick('edit_meeting_title', 'sidebar');

      toast.success("Meeting title updated successfully");

      // Close modal and reset state
      setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
      setEditingTitle('');
    } catch (error) {
      console.error('Failed to update meeting title:', error);
      toast.error("Failed to update meeting title", {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const handleEditCancel = () => {
    setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
    setEditingTitle('');
  };

  const toggleFolder = (folderId: string) => {
    // Normal toggle behavior for all folders
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };

  // Expose setShowModelSettings to window for Rust tray to call
  useEffect(() => {
    (window as any).openSettings = () => {
      setShowModelSettings(true);
    };

    // Cleanup on unmount
    return () => {
      delete (window as any).openSettings;
    };
  }, []);

  const renderCollapsedIcons = () => {
    if (!isCollapsed) return null;

    const isHomePage = pathname === '/';
    const isMeetingPage = pathname?.includes('/meeting-details');
    const isSettingsPage = pathname === '/settings';

    return (
      <TooltipProvider>
        <div className="flex flex-col items-center space-y-4 mt-4">
          <Logo isCollapsed={isCollapsed} />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => router.push('/')}
                className={`p-2 rounded-lg transition-colors duration-150 ${isHomePage ? 'bg-white/10' : 'hover:bg-white/10'
                  }`}
              >
                <Home className="w-5 h-5 text-foreground/75" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Home</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  if (isCollapsed) toggleCollapse();
                  toggleFolder('meetings');
                }}
                className={`p-2 rounded-lg transition-colors duration-150 ${isMeetingPage ? 'bg-white/10' : 'hover:bg-white/10'
                  }`}
              >
                <NotebookPen className="w-5 h-5 text-foreground/75" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Meeting Notes</p>
            </TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onMouseEnter={() => setHoverCollapsedSettings(true)}
                onMouseLeave={() => setHoverCollapsedSettings(false)}
                className="p-2 rounded-xl transition-all duration-300"
                title="Settings"
                style={{
                  background: isSettingsPage || hoverCollapsedSettings ? 'hsl(var(--primary) / 0.18)' : 'hsl(var(--background) / 0.7)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  border: `1px solid ${hoverCollapsedSettings ? 'hsl(var(--primary) / 0.32)' : 'hsl(var(--border) / 0.85)'}`,
                  boxShadow: hoverCollapsedSettings
                    ? '0 0 18px hsl(var(--primary) / 0.16), inset 0 1px 0 rgba(255,255,255,0.12)'
                    : 'inset 0 1px 0 rgba(255,255,255,0.06)',
                  transform: hoverCollapsedSettings ? 'scale(1.06)' : 'scale(1)',
                }}
              >
                <Settings className="w-5 h-5 text-foreground/75" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="right" className="w-56">
              <DropdownMenuLabel>Settings</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => router.push('/settings')}>
                Open Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Theme</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={uiTheme}
                onValueChange={(value) => setUiTheme(value as ThemeName)}
              >
                {THEME_OPTIONS.map((theme) => (
                  <DropdownMenuRadioItem key={theme.value} value={theme.value}>
                    {theme.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

        </div>
      </TooltipProvider>
    );
  };

  // Find matching transcript snippet for a meeting item
  const findMatchingSnippet = (itemId: string) => {
    if (!searchQuery.trim() || !searchResults.length) return null;
    return searchResults.find(result => result.id === itemId);
  };

  const renderItem = (item: SidebarItem, depth = 0) => {
    const isExpanded = expandedFolders.has(item.id);
    const paddingLeft = `${depth * 12 + 12}px`;
    const isActive = item.type === 'file' && currentMeeting?.id === item.id;
    const isMeetingItem = item.id.includes('-') && !item.id.startsWith('intro-call');

    // Check if this item has a matching transcript snippet
    const matchingResult = isMeetingItem ? findMatchingSnippet(item.id) : null;
    const hasTranscriptMatch = !!matchingResult;

    if (isCollapsed) return null;

    return (
      <div key={item.id}>
        <div
          className={`flex items-center transition-all duration-150 group ${item.type === 'folder' && depth === 0
            ? 'p-3 text-lg font-semibold h-10 mx-3 mt-3 rounded-lg'
            : `px-3 py-2 my-0.5 rounded-md text-sm ${isActive ? 'bg-emerald-500/20 text-emerald-100 font-medium' :
              hasTranscriptMatch ? 'bg-emerald-500/15 text-emerald-200' : 'hover:bg-white/5'
            } cursor-pointer`
            }`}
          style={item.type === 'folder' && depth === 0 ? {} : { paddingLeft }}
          onClick={() => {
            if (item.type === 'folder') {
              toggleFolder(item.id);
            } else {
              setCurrentMeeting({ id: item.id, title: item.title });
              const basePath = item.id.startsWith('intro-call') ? '/' :
                item.id.includes('-') ? `/meeting-details?id=${item.id}` : `/notes/${item.id}`;
              router.push(basePath);
            }
          }}
        >
          {item.type === 'folder' ? (
            <>
              {item.id === 'meetings' ? (
                <Calendar className="w-4 h-4 mr-2" />
              ) : item.id === 'notes' ? (
                <Calendar className="w-4 h-4 mr-2" />
              ) : null}
              <span className={depth === 0 ? "" : "font-medium"}>{item.title}</span>
              <div className="ml-auto">
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-foreground/55" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-foreground/55" />
                )}
              </div>
              {searchQuery && item.id === 'meetings' && isSearching && (
                <span className="ml-2 text-xs text-emerald-300 animate-pulse">Searching...</span>
              )}
            </>
          ) : (
            <div className="flex flex-col w-full">
              <div className="flex items-center w-full">
                {isMeetingItem ? (
                  <div className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full mr-2 bg-white/10">
                    <File className="w-3.5 h-3.5 text-foreground/65" />
                  </div>
                ) : (
                  <div className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full mr-2 bg-emerald-500/15">
                    <Plus className="w-3.5 h-3.5 text-emerald-300" />
                  </div>
                )}
                <span className="flex-1 break-words text-foreground/85">{item.title}</span>
                {isMeetingItem && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditStart(item.id, item.title);
                      }}
                      className="hover:text-emerald-300 p-1 rounded-md hover:bg-emerald-500/15 flex-shrink-0"
                      aria-label="Edit meeting title"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteModalState({ isOpen: true, itemId: item.id });
                      }}
                      className="hover:text-emerald-300 p-1 rounded-md hover:bg-emerald-500/15 flex-shrink-0"
                      aria-label="Delete meeting"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Show match snippet with source badge (transcript / notes / summary / title) */}
              {hasTranscriptMatch && (
                <div className="mt-1 ml-8 text-xs text-emerald-200/90 bg-emerald-500/10 p-1.5 rounded border border-emerald-400/20 line-clamp-2">
                  {matchingResult.matchSource && (
                    <span className="inline-block mr-1.5 px-1 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                      {matchingResult.matchSource}
                    </span>
                  )}
                  {matchingResult.matchContext
                    ? <span dangerouslySetInnerHTML={{ __html: matchingResult.matchContext }} />
                    : null
                  }
                </div>
              )}
            </div>
          )}
        </div>
        {item.type === 'folder' && isExpanded && item.children && (
          <div className="ml-1">
            {item.children.map(child => renderItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed top-0 left-0 h-screen z-40">
      {/* Floating collapse button */}
      <button
        onClick={toggleCollapse}
        className="absolute -right-6 top-20 z-50 p-1 bg-secondary/80 hover:bg-secondary/60 rounded-full shadow-lg border border-secondary"
        style={{ transform: 'translateX(50%)' }}
      >
        {isCollapsed ? (
          <ChevronRightCircle className="w-6 h-6" />
        ) : (
          <ChevronLeftCircle className="w-6 h-6" />
        )}
      </button>

      <div
        className={`h-screen bg-background border-r border-white/10 shadow-sm flex flex-col transition-all duration-300 ${isCollapsed ? 'w-16' : 'w-64'
          }`}
      >
        {/*  Header with traffic light spacing */}
        <div className="flex-shrink-0 h-22 flex items-center">

          {/* Title container */}



          <div className="flex-1">
            {!isCollapsed && (
              <div className="p-3">
                {/* <span className="text-lg text-center border rounded-full bg-blue-50 border-white font-semibold text-gray-700 mb-2 block items-center">
                  <span>Adamant</span>
                </span> */}
                <Logo isCollapsed={isCollapsed} />

                <div className="relative mb-1">
                  <InputGroup >
                    <InputGroupInput placeholder='Search meeting content...' value={searchQuery}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <InputGroupAddon>
                      <SearchIcon />
                    </InputGroupAddon>
                    {searchQuery &&
                      <InputGroupAddon align={'inline-end'}>
                        <InputGroupButton
                          onClick={() => handleSearchChange('')}
                        >
                          <X />
                        </InputGroupButton>
                      </InputGroupAddon>
                    }
                  </InputGroup>
                </div>

              </div>
            )}
          </div>
        </div>

        {/* Main content - scrollable area */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Fixed navigation items */}
          <div className="flex-shrink-0">
            {!isCollapsed && !isSearchMode && (
              <div
                onClick={() => router.push('/')}
                className="p-3 text-lg font-semibold items-center hover:bg-white/10 h-10 flex mx-3 mt-3 rounded-lg cursor-pointer"
              >
                <Home className="w-4 h-4 mr-2" />
                <span>Home</span>
              </div>
            )}
          </div>

          {/* Content area */}
          <div className="flex-1 flex flex-col min-h-0">
            {renderCollapsedIcons()}

            {!isCollapsed && isSearchMode && (
              <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 px-3 pb-4">
                <div className="mt-3">
                  <div className="flex items-center h-8 mb-1">
                    <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Folders</span>
                  </div>
                  {folderSearchItems.map((item) => (
                    item.folderData ? (
                      <FolderItem
                        key={item.id}
                        folder={item.folderData}
                        children={item.children ?? []}
                        isSidebarCollapsed={isCollapsed}
                        activeMeetingId={currentMeeting?.id}
                        renderMeetingItem={(child) => (
                          <SidebarMeetingRow
                            key={child.id}
                            title={child.title}
                            isActive={currentMeeting?.id === child.id}
                            isSelected={selectedMeetingIds.has(child.id)}
                            onToggleSelect={(e) => toggleMeetingSelection(child.id, e)}
                            onNavigate={() => {
                              setCurrentMeeting({ id: child.id, title: child.title });
                              router.push(`/meeting-details?id=${child.id}`);
                            }}
                            onEdit={() => handleEditStart(child.id, child.title)}
                            onDelete={() => setDeleteModalState({ isOpen: true, itemId: child.id })}
                          />
                        )}
                      />
                    ) : null
                  ))}

                  <div className="flex items-center h-8 mt-4 mb-1">
                    <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Meeting Notes</span>
                  </div>
                  {searchResultItems.map((item) => (
                    <SidebarMeetingRow
                      key={item.id}
                      title={item.title}
                      isActive={currentMeeting?.id === item.id}
                      isSelected={selectedMeetingIds.has(item.id)}
                      onToggleSelect={(e) => toggleMeetingSelection(item.id, e)}
                      onNavigate={() => {
                        setCurrentMeeting({ id: item.id, title: item.title });
                        router.push(`/meeting-details?id=${item.id}`);
                      }}
                      onEdit={() => handleEditStart(item.id, item.title)}
                      onDelete={() => setDeleteModalState({ isOpen: true, itemId: item.id })}
                    />
                  ))}
                </div>
              </div>
            )}

            {!isCollapsed && !isSearchMode && (
              <DndContext
                sensors={sensors}
                collisionDetection={folderCollisionDetection}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
                onDragCancel={handleDragCancel}
              >
                <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 px-3 pb-4">

                  {/* ── Folders section ── */}
                  <div
                    className="flex items-center justify-between h-8 mt-3 mb-1 cursor-pointer select-none"
                    onClick={toggleFolders}
                  >
                    <div className="flex items-center gap-1">
                      {/* Collapse chevron — matches Meeting Notes chevron style */}
                      <span className="text-zinc-500 flex-shrink-0">
                        {isFoldersExpanded
                          ? <ChevronDown className="h-3 w-3" />
                          : <ChevronRight className="h-3 w-3" />}
                      </span>
                      <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Folders</span>
                    </div>
                    {/* New folder button — stop propagation so it doesn't also toggle collapse */}
                    <button
                      className="p-1 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors"
                      title="New folder"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsCreatingFolder(true);
                        setNewFolderName('');
                        setTimeout(() => newFolderInputRef.current?.focus(), 0);
                      }}
                    >
                      <FolderPlus className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Folder list + inline creation — hidden when collapsed */}
                  <div className={cn(
                    'overflow-hidden transition-all duration-200',
                    isFoldersExpanded ? 'max-h-[9999px] opacity-100' : 'max-h-0 opacity-0',
                  )}>
                  {/* Inline new-folder input */}
                  {isCreatingFolder && (
                    <div className="flex items-center gap-1 mb-1 px-2 py-1 bg-white/5 rounded-md">
                      <input
                        ref={newFolderInputRef}
                        className="flex-1 bg-transparent text-sm text-white outline-none border-b border-primary"
                        placeholder="Folder name…"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onBlur={commitNewFolder}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitNewFolder();
                          if (e.key === 'Escape') { setNewFolderName(''); setIsCreatingFolder(false); }
                        }}
                      />
                    </div>
                  )}

                  {/* User-created folder tree — visible folder rows are one sortable tree. */}
                  <div className="relative">
                    <SortableContext
                      items={folderRows.map((row) => folderTreeId(row.id))}
                      strategy={verticalListSortingStrategy}
                    >
                      {folderTreeNodes.map((node) => {
                        if (node.type === 'meeting') {
                          return (
                            <DraggableMeetingRow
                              key={`meeting:${node.meeting.id}`}
                              item={{ id: node.meeting.id, title: node.meeting.title, type: 'file' }}
                              isActive={currentMeeting?.id === node.meeting.id}
                              indent
                              isSelected={selectedMeetingIds.has(node.meeting.id)}
                              onToggleSelect={(e) => toggleMeetingSelection(node.meeting.id, e)}
                              setRowRef={setMeetingRowRef}
                              onNavigate={() => {
                                setCurrentMeeting({ id: node.meeting.id, title: node.meeting.title });
                                router.push(`/meeting-details?id=${node.meeting.id}`);
                              }}
                              onEdit={() => handleEditStart(node.meeting.id, node.meeting.title)}
                              onDelete={() => setDeleteModalState({ isOpen: true, itemId: node.meeting.id })}
                            />
                          );
                        }

                        return (
                          <SortableFolderTreeRow
                            key={node.row.id}
                            row={node.row}
                            childCount={(foldersByParent.get(node.row.id)?.length ?? 0) + (meetingsByFolder.get(node.row.id)?.length ?? 0)}
                            isExpanded={isFolderExpanded(node.row.id)}
                            isActiveMeeting={currentMeeting?.id}
                            projection={folderDropProjection}
                            isMeetingDropTarget={meetingDropFolderId === node.row.id}
                            setRowRef={setFolderRowRef}
                            onToggleExpanded={() => setFolderExpanded(node.row.id, !isFolderExpanded(node.row.id))}
                            onRename={renameFolder}
                            onDelete={deleteFolder}
                            onCreateSubfolder={async () => {
                              await createFolder('New Folder', node.row.id);
                              setFolderExpanded(node.row.id, true);
                            }}
                            onCreateMeeting={async () => {
                              const now = new Date();
                              const title = `${now.getMonth() + 1}-${now.getDate()}-${String(now.getFullYear()).slice(-2)} new note`;
                              const meeting = await invoke<{ id: string }>('api_create_meeting', { title });
                              await moveMeetingToFolder(meeting.id, node.row.id);
                              router.push(`/meeting-details?id=${meeting.id}`);
                            }}
                          />
                        );
                      })}
                    </SortableContext>
                    <FolderRootBottomDropZone
                      isActive={folderDropProjection?.type === 'root-bottom'}
                    />
                  </div>
                  </div>{/* end collapsible folders wrapper */}

                  {/* ── Meeting Notes (unfiled) section ── */}
                  <div
                    className="flex items-center justify-between h-8 mt-4 mb-1 cursor-pointer select-none"
                    onClick={toggleMeetingNotes}
                  >
                    <div className="flex items-center gap-1">
                      {/* Collapse chevron — matches folder chevron style */}
                      <span className="text-zinc-500 flex-shrink-0">
                        {isMeetingNotesExpanded
                          ? <ChevronDown className="h-3 w-3" />
                          : <ChevronRight className="h-3 w-3" />}
                      </span>
                      <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Meeting Notes</span>
                      {searchQuery && isSearching && (
                        <span className="ml-2 text-xs text-emerald-300 animate-pulse">Searching…</span>
                      )}
                    </div>
                    {/* New unfiled note — always visible, matches Folders "+" pattern */}
                    <button
                      className="p-0.5 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title="New meeting note"
                      disabled={isCreatingUnfiled}
                      onClick={async (e) => {
                        e.stopPropagation(); // don't collapse the section when clicking "+"
                        if (isCreatingUnfiled) return;
                        setIsCreatingUnfiled(true);
                        try {
                          const now = new Date();
                          const title = `${now.getMonth() + 1}-${now.getDate()}-${String(now.getFullYear()).slice(-2)} new note`;
                          const meeting = await invoke<{ id: string }>('api_create_meeting', { title });
                          await refetchMeetings();
                          Analytics.trackButtonClick('start_new_meeting', 'meeting_notes_section');
                          router.push(`/meeting-details?id=${meeting.id}`);
                        } catch (err) {
                          console.error('Failed to create unfiled meeting note:', err);
                        } finally {
                          setIsCreatingUnfiled(false);
                        }
                      }}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Unfiled droppable root zone — hidden when section is collapsed */}
                  <div className={cn(
                    'overflow-hidden transition-all duration-200',
                    isMeetingNotesExpanded ? 'max-h-[9999px] opacity-100' : 'max-h-0 opacity-0',
                  )}>
                    <UnfiledDropZone>
                      {sidebarItems
                        .filter((item) => item.type === 'file' && !meetings.find((m) => m.id === item.id)?.folder_id)
                        .map((item) => (
                          <DraggableMeetingRow
                            key={item.id}
                            item={item}
                            isActive={currentMeeting?.id === item.id}
                            indent={false}
                            isSelected={selectedMeetingIds.has(item.id)}
                            onToggleSelect={(e) => toggleMeetingSelection(item.id, e)}
                            setRowRef={setMeetingRowRef}
                            onNavigate={() => {
                              setCurrentMeeting({ id: item.id, title: item.title });
                              router.push(`/meeting-details?id=${item.id}`);
                            }}
                            onEdit={() => handleEditStart(item.id, item.title)}
                            onDelete={() => setDeleteModalState({ isOpen: true, itemId: item.id })}
                          />
                        ))}
                    </UnfiledDropZone>
                  </div>

                  {/* ── To Do's section ── */}
                  {(() => {
                    if (todoDates.length === 0) return null;
                    const totalTodoCount = todoDates.reduce((sum, item) => sum + item.count, 0);
                    const totalUncheckedCount = todoDates.reduce((sum, item) => sum + item.unchecked, 0);

                    return (
                      <>
                        <div
                          className="flex items-center justify-between h-8 mt-4 mb-1 cursor-pointer select-none"
                          onClick={toggleTodos}
                        >
                        <div className="flex items-center gap-1">
                          <span className="text-zinc-500 flex-shrink-0">
                            {isTodosExpanded
                              ? <ChevronDown className="h-3 w-3" />
                              : <ChevronRight className="h-3 w-3" />}
                          </span>
                          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">To Do&apos;s</span>
                        </div>
                      </div>

                        <div className={cn(
                          'overflow-hidden transition-all duration-200',
                          isTodosExpanded ? 'max-h-[9999px] opacity-100' : 'max-h-0 opacity-0',
                        )}>
                          <TodoAllRow
                            totalCount={totalTodoCount}
                            uncheckedCount={totalUncheckedCount}
                            isActive={pathname === '/todos' && !activeTodoDate}
                            onNavigate={() => router.push('/todos')}
                          />
                          {todoDates.map((dateSummary) => (
                            <TodoDateNavRow
                              key={dateSummary.date}
                              date={dateSummary.date}
                              count={dateSummary.unchecked}
                              totalCount={dateSummary.count}
                              isActive={pathname === '/todos' && activeTodoDate === dateSummary.date}
                            />
                          ))}
                        </div>
                      </>
                    );
                  })()}

                  {/* ── By Date virtual section ── */}
                  {(() => {
                    // Group ALL meetings (regardless of folder) by creation date M/D/YYYY,
                    // sorted descending so most-recent dates appear first.
                    const groupsByDate: Map<string, typeof meetings> = new Map();
                    for (const m of meetings) {
                      if (!m.created_at) continue;
                      const d = new Date(m.created_at);
                      // Format as M/D/YYYY in local time (matches what the user sees)
                      const label = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
                      if (!groupsByDate.has(label)) groupsByDate.set(label, []);
                      groupsByDate.get(label)!.push(m);
                    }

                    // Sort date keys descending (newest first)
                    const sortedDates = Array.from(groupsByDate.keys()).sort((a, b) => {
                      return new Date(b).getTime() - new Date(a).getTime();
                    });

                    if (sortedDates.length === 0) return null;

                    return (
                      <>
                        {/* Section header */}
                        <div
                          className="flex items-center justify-between h-8 mt-4 mb-1 cursor-pointer select-none"
                          onClick={toggleByDate}
                        >
                          <div className="flex items-center gap-1">
                            <span className="text-zinc-500 flex-shrink-0">
                              {isByDateExpanded
                                ? <ChevronDown className="h-3 w-3" />
                                : <ChevronRight className="h-3 w-3" />}
                            </span>
                            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">By Date</span>
                          </div>
                        </div>

                        {/* Date group rows — hidden when section collapsed */}
                        <div className={cn(
                          'overflow-hidden transition-all duration-200',
                          isByDateExpanded ? 'max-h-[9999px] opacity-100' : 'max-h-0 opacity-0',
                        )}>
                          {sortedDates.map((dateLabel) => {
                            const dateMeetings = groupsByDate.get(dateLabel)!;
                            const dateMeetingIds = dateMeetings.map((m) => m.id);
                            const allDateMeetingsSelected =
                              dateMeetingIds.length > 0 && dateMeetingIds.every((id) => selectedMeetingIds.has(id));
                            const someDateMeetingsSelected =
                              dateMeetingIds.some((id) => selectedMeetingIds.has(id));
                            const isGroupExpanded = expandedDateGroups.has(dateLabel);
                            return (
                              <div key={dateLabel} className="rounded-md">
                                {/* Date header row */}
                                <div
                                  className={cn(
                                    "group flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer select-none transition-colors",
                                    someDateMeetingsSelected ? "bg-emerald-500/10 hover:bg-emerald-500/15" : "hover:bg-white/5"
                                  )}
                                  onClick={() => toggleDateGroup(dateLabel)}
                                >
                                  <button
                                    type="button"
                                    className="flex-shrink-0 p-0.5 rounded hover:bg-emerald-500/15"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => toggleDateSelection(dateMeetingIds, e)}
                                    aria-label={
                                      allDateMeetingsSelected
                                        ? `Unselect all meetings from ${dateLabel}`
                                        : `Select all meetings from ${dateLabel}`
                                    }
                                    title={
                                      allDateMeetingsSelected
                                        ? `Unselect all meetings from ${dateLabel}`
                                        : `Select all meetings from ${dateLabel}`
                                    }
                                  >
                                    {allDateMeetingsSelected ? (
                                      <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                                    ) : (
                                      <Square className={cn(
                                        "w-3.5 h-3.5 transition-opacity",
                                        someDateMeetingsSelected
                                          ? "opacity-100 text-emerald-400"
                                          : "opacity-0 group-hover:opacity-100 text-foreground/30"
                                      )} />
                                    )}
                                  </button>
                                  <span className="text-zinc-500 flex-shrink-0">
                                    {isGroupExpanded
                                      ? <ChevronDown className="h-3 w-3" />
                                      : <ChevronRight className="h-3 w-3" />}
                                  </span>
                                  <span className="flex-1 text-sm font-medium text-zinc-300 truncate">{dateLabel}</span>
                                  {/* Meeting count badge */}
                                  <span className="text-xs text-zinc-500 flex-shrink-0 ml-1">{dateMeetings.length}</span>
                                  <button
                                    type="button"
                                    className="p-0.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDateDeleteModalState({
                                        isOpen: true,
                                        dateLabel,
                                        meetingIds: dateMeetingIds,
                                      });
                                    }}
                                    aria-label={`Delete all meetings from ${dateLabel}`}
                                    title={`Delete all meetings from ${dateLabel}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                {/* Meeting rows inside the date group */}
                                <div className={cn(
                                  'overflow-hidden transition-all duration-200',
                                  isGroupExpanded ? 'max-h-[9999px] opacity-100' : 'max-h-0 opacity-0',
                                )}>
                                  <div className="ml-4 border-l border-white/5">
                                    {dateMeetings.map((m) => {
                                      const isActive = currentMeeting?.id === m.id;
                                      return (
                                        <SidebarMeetingRow
                                          key={m.id}
                                          title={m.title}
                                          isActive={isActive}
                                          isSelected={selectedMeetingIds.has(m.id)}
                                          onToggleSelect={(e) => toggleMeetingSelection(m.id, e)}
                                          onNavigate={() => {
                                            setCurrentMeeting({ id: m.id, title: m.title });
                                            router.push(`/meeting-details?id=${m.id}`);
                                          }}
                                          onEdit={() => handleEditStart(m.id, m.title)}
                                          onDelete={() => setDeleteModalState({ isOpen: true, itemId: m.id })}
                                        />
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </DndContext>
            )}
          </div>
        </div>

        {/* Bulk-delete selection bar — slides in when 1+ meetings are checked */}
        {!isCollapsed && selectedMeetingIds.size > 0 && (
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-zinc-900 border-t border-white/10">
            <button
              onClick={clearSelection}
              className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
              aria-label="Clear selection"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <span className="flex-1 text-xs text-zinc-300">
              {selectedMeetingIds.size} meeting{selectedMeetingIds.size !== 1 ? 's' : ''} selected
            </span>
            <button
              onClick={() => setBulkDeleteModalOpen(true)}
              className="px-2.5 py-1 text-xs font-medium text-white bg-red-600/80 hover:bg-red-600 rounded-md transition-colors"
            >
              Delete
            </button>
          </div>
        )}

        {/* Footer */}
        {!isCollapsed && (

          <div className="flex-shrink-0 p-2 border-t border-white/10">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onMouseEnter={() => setHoverExpandedSettings(true)}
                  onMouseLeave={() => setHoverExpandedSettings(false)}
                  className="w-full flex items-center justify-center px-3 py-1.5 mt-1 mb-1 text-sm font-medium rounded-xl transition-all duration-300"
                  style={{
                    background: hoverExpandedSettings ? 'hsl(var(--primary) / 0.16)' : 'hsl(var(--background) / 0.65)',
                    backdropFilter: 'blur(24px)',
                    WebkitBackdropFilter: 'blur(24px)',
                    border: `1px solid ${hoverExpandedSettings ? 'hsl(var(--primary) / 0.28)' : 'hsl(var(--border) / 0.85)'}`,
                    color: hoverExpandedSettings ? 'hsl(var(--foreground) / 0.98)' : 'hsl(var(--foreground) / 0.78)',
                    boxShadow: hoverExpandedSettings
                      ? '0 4px 20px rgba(0,0,0,0.16), 0 0 14px hsl(var(--primary) / 0.14), inset 0 1px 0 rgba(255,255,255,0.14)'
                      : '0 2px 16px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.08)',
                    transform: hoverExpandedSettings ? 'translateY(-1px)' : 'translateY(0)',
                  }}
                >
                  <Settings className="w-4 h-4 mr-2" />
                  <span>Settings</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} className="w-56">
                <DropdownMenuLabel>Settings</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => router.push('/settings')}>
                  Open Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Theme</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={uiTheme}
                  onValueChange={(value) => setUiTheme(value as ThemeName)}
                >
                  {THEME_OPTIONS.map((theme) => (
                    <DropdownMenuRadioItem key={theme.value} value={theme.value}>
                      {theme.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Confirmation Modal for single-meeting delete */}
      <ConfirmationModal
        isOpen={deleteModalState.isOpen}
        text="Are you sure you want to delete this meeting? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteModalState({ isOpen: false, itemId: null })}
      />

      {/* Confirmation Modal for bulk delete */}
      <ConfirmationModal
        isOpen={bulkDeleteModalOpen}
        text={`Delete ${selectedMeetingIds.size} meeting${selectedMeetingIds.size !== 1 ? 's' : ''}? This action cannot be undone.`}
        onConfirm={handleBulkDelete}
        onCancel={() => setBulkDeleteModalOpen(false)}
      />

      {/* Confirmation Modal for deleting a whole By Date group */}
      <ConfirmationModal
        isOpen={dateDeleteModalState.isOpen}
        text={`Delete ${dateDeleteModalState.meetingIds.length} meeting${dateDeleteModalState.meetingIds.length !== 1 ? 's' : ''} from ${dateDeleteModalState.dateLabel}? This action cannot be undone.`}
        onConfirm={handleDateDeleteConfirm}
        onCancel={() => setDateDeleteModalState({ isOpen: false, dateLabel: null, meetingIds: [] })}
      />

      {/* Edit Meeting Title Modal */}
      <Dialog open={editModalState.isOpen} onOpenChange={(open) => {
        if (!open) handleEditCancel();
      }}>
        <DialogContent className="sm:max-w-[425px]">
          <VisuallyHidden>
            <DialogTitle>Edit Meeting Title</DialogTitle>
          </VisuallyHidden>
          <div className="py-4">
            <h3 className="text-lg font-semibold mb-4">Edit Meeting Title</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="meeting-title" className="block text-sm font-medium text-foreground/85 mb-2">
                  Meeting Title
                </label>
                <input
                  id="meeting-title"
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleEditConfirm();
                    } else if (e.key === 'Escape') {
                      handleEditCancel();
                    }
                  }}
                  className="w-full px-3 py-2 border border-white/20 bg-black/20 text-foreground rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
                  placeholder="Enter meeting title"
                  autoFocus
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={handleEditCancel}
              className="px-4 py-2 text-sm font-medium text-foreground/85 bg-white/10 hover:bg-white/15 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleEditConfirm}
              className="px-4 py-2 text-sm font-semibold text-black bg-gradient-to-r from-emerald-500 to-green-400 hover:from-emerald-400 hover:to-green-300 rounded-md transition-colors"
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Helper: To Do's sidebar rows
// ---------------------------------------------------------------------------

function TodoAllRow({
  totalCount,
  uncheckedCount,
  isActive,
  onNavigate,
}: {
  totalCount: number;
  uncheckedCount: number;
  isActive: boolean;
  onNavigate: () => void;
}) {
  return (
    <button
      onClick={onNavigate}
      className={cn(
        "group flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors text-left",
        isActive ? "bg-primary/10 text-zinc-100" : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
      )}
    >
      <ListTodo className="h-3.5 w-3.5 text-primary flex-shrink-0" />
      <span className="flex-1 truncate font-medium">All</span>
      <span className="text-xs text-zinc-500 flex-shrink-0">({totalCount})</span>
      {uncheckedCount > 0 && (
        <span className="text-xs text-zinc-600 flex-shrink-0">· {uncheckedCount} open</span>
      )}
    </button>
  );
}

function TodoDateNavRow({
  date,
  count,
  totalCount,
  isActive,
}: {
  date: string;
  count: number;
  totalCount: number;
  isActive: boolean;
}) {
  const router = useRouter();
  const d = new Date(date + "T00:00:00");
  const label = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;

  return (
    <button
      onClick={() => router.push(`/todos?date=${date}`)}
      className={cn(
        "group flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors text-left ml-2",
        isActive ? "bg-primary/10 text-zinc-100" : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
      )}
    >
      <Calendar className="h-3.5 w-3.5 text-primary flex-shrink-0" />
      <span className="flex-1 truncate font-medium">{label}</span>
      <span className="text-xs text-zinc-500 flex-shrink-0">({count})</span>
      <span className="text-xs text-zinc-600 flex-shrink-0">· {totalCount} total</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helper: non-draggable meeting row used by virtual sections such as By Date
// ---------------------------------------------------------------------------

interface SidebarMeetingRowProps {
  title: string;
  isActive: boolean;
  isSelected?: boolean;
  onToggleSelect: (e: React.MouseEvent) => void;
  onNavigate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function SidebarMeetingRow({
  title,
  isActive,
  isSelected,
  onToggleSelect,
  onNavigate,
  onEdit,
  onDelete,
}: SidebarMeetingRowProps) {
  return (
    <div
      className={`flex items-center px-2 py-1.5 my-0.5 rounded-md text-sm cursor-pointer group transition-colors ${
        isSelected
          ? 'bg-emerald-500/10 text-emerald-100'
          : isActive
          ? 'bg-emerald-500/20 text-emerald-100 font-medium'
          : 'hover:bg-white/5 text-foreground/85'
      }`}
      onClick={onNavigate}
    >
      <div
        className="flex-shrink-0 mr-1.5"
        onClick={onToggleSelect}
      >
        {isSelected ? (
          <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <Square className="w-3.5 h-3.5 text-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>

      <div className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full mr-2 bg-white/10">
        <File className="w-3 h-3 text-foreground/65" />
      </div>
      <span className="flex-1 break-words truncate">{title}</span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="p-0.5 rounded hover:text-emerald-300 hover:bg-emerald-500/15"
          aria-label="Edit meeting title"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-0.5 rounded hover:text-red-400 hover:bg-red-900/20"
          aria-label="Delete meeting"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: draggable meeting row
// ---------------------------------------------------------------------------

interface DraggableMeetingRowProps {
  item: SidebarItem;
  isActive: boolean;
  indent?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (e: React.MouseEvent) => void;
  setRowRef?: (meetingId: string, node: HTMLDivElement | null) => void;
  onNavigate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function DraggableMeetingRow({ item, isActive, indent, isSelected, onToggleSelect, setRowRef, onNavigate, onEdit, onDelete }: DraggableMeetingRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `meeting:${item.id}`,
    data: { type: 'meeting', meetingId: item.id },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.5 : 1 }
    : undefined;

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setRowRef?.(item.id, node);
      }}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex items-center px-2 py-1.5 my-0.5 rounded-md text-sm cursor-pointer group transition-colors ${
        isSelected
          ? 'bg-emerald-500/10 text-emerald-100'
          : isActive
          ? 'bg-emerald-500/20 text-emerald-100 font-medium'
          : 'hover:bg-white/5 text-foreground/85'
      } ${indent ? 'pl-3' : ''}`}
      onClick={onNavigate}
    >
      {/* Checkbox — visible on hover or when already selected */}
      <div
        className="flex-shrink-0 mr-1.5"
        // Prevent drag initiation when interacting with the checkbox
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onToggleSelect}
      >
        {isSelected ? (
          <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <Square className="w-3.5 h-3.5 text-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>

      <div className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full mr-2 bg-white/10">
        <File className="w-3 h-3 text-foreground/65" />
      </div>
      <span className="flex-1 break-words truncate">{item.title}</span>
      <div
        className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        // Prevent drag when clicking action buttons
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="p-0.5 rounded hover:text-emerald-300 hover:bg-emerald-500/15"
          aria-label="Edit meeting title"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-0.5 rounded hover:text-red-400 hover:bg-red-900/20"
          aria-label="Delete meeting"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: sortable visible folder row for tree ordering/nesting
// ---------------------------------------------------------------------------

function SortableFolderTreeRow({
  row,
  childCount,
  isExpanded,
  projection,
  isMeetingDropTarget,
  setRowRef,
  onToggleExpanded,
  onRename,
  onDelete,
  onCreateSubfolder,
  onCreateMeeting,
}: {
  row: FolderRow;
  childCount: number;
  isExpanded: boolean;
  isActiveMeeting?: string;
  projection: FolderDropProjection | null;
  isMeetingDropTarget: boolean;
  setRowRef: (folderId: string, node: HTMLDivElement | null) => void;
  onToggleExpanded: () => void;
  onRename: (folderId: string, name: string) => Promise<void>;
  onDelete: (folderId: string) => Promise<void>;
  onCreateSubfolder: () => Promise<void>;
  onCreateMeeting: () => Promise<void>;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(row.folder.name);
  const [isCreatingSubfolder, setIsCreatingSubfolder] = useState(false);
  const [isCreatingMeeting, setIsCreatingMeeting] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: folderTreeId(row.id),
    data: { type: 'folder-tree-row', folderId: row.id },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };
  const isInsideTarget = projection?.type === 'inside' && projection.targetId === row.id;
  const isFolderDropHighlighted = isInsideTarget || isMeetingDropTarget;
  const showBeforeLine = projection?.type === 'before' && projection.targetId === row.id;
  const showAfterLine = projection?.type === 'after' && projection.targetId === row.id;

  const startRename = (event: React.MouseEvent) => {
    event.stopPropagation();
    setRenameValue(row.folder.name);
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  const commitRename = async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== row.folder.name) {
      await onRename(row.id, trimmed);
    }
    setIsRenaming(false);
  };

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setRowRef(row.id, node);
      }}
      style={style}
      className="relative rounded-md"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {showBeforeLine && <FolderInsertionLine position="top" />}
      <div
        {...attributes}
        {...listeners}
        className={cn(
          'flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer select-none group transition-colors',
          isFolderDropHighlighted ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-white/5',
        )}
        style={{ paddingLeft: `${row.depth * 12 + 8}px` }}
        onClick={onToggleExpanded}
      >
        <span className="text-zinc-500 flex-shrink-0">
          {isExpanded
            ? <ChevronDown className="h-3 w-3" />
            : <ChevronRight className="h-3 w-3" />}
        </span>
        <span className="text-zinc-400 flex-shrink-0">
          {isExpanded
            ? <FolderOpen className="h-3.5 w-3.5" />
            : <FolderIcon className="h-3.5 w-3.5" />}
        </span>
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="flex-1 bg-transparent text-sm text-white border-b border-primary outline-none px-0.5"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename();
              if (event.key === 'Escape') {
                setRenameValue(row.folder.name);
                setIsRenaming(false);
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span
            className="flex-1 text-sm font-medium text-zinc-200 truncate"
            onDoubleClick={startRename}
          >
            {row.folder.name}
          </span>
        )}
        {!isRenaming && (
          <span className="text-xs text-zinc-500 flex-shrink-0 ml-1">
            {childCount}
          </span>
        )}
        {isHovered && !isRenaming && (
          <div
            className="flex items-center gap-0.5 ml-1 flex-shrink-0"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="p-0.5 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors"
              title="Rename folder"
              onClick={startRename}
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              className="p-0.5 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="New subfolder"
              disabled={isCreatingSubfolder}
              onClick={async () => {
                setIsCreatingSubfolder(true);
                try {
                  await onCreateSubfolder();
                } finally {
                  setIsCreatingSubfolder(false);
                }
              }}
            >
              <FolderPlus className="h-3 w-3" />
            </button>
            <button
              className="p-0.5 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="New meeting in folder"
              disabled={isCreatingMeeting}
              onClick={async () => {
                setIsCreatingMeeting(true);
                try {
                  await onCreateMeeting();
                } finally {
                  setIsCreatingMeeting(false);
                }
              }}
            >
              <Plus className="h-3 w-3" />
            </button>
            <button
              className="p-0.5 rounded hover:bg-red-900/30 text-zinc-500 hover:text-red-400 transition-colors"
              title="Delete folder"
              onClick={() => onDelete(row.id)}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
      {showAfterLine && <FolderInsertionLine position="bottom" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: folder insertion feedback
// ---------------------------------------------------------------------------

function FolderInsertionLine({ position }: { position: 'top' | 'bottom' }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute left-1 right-1 z-20 h-0.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.55)]',
        position === 'top' ? 'top-0' : 'bottom-0',
      )}
    />
  );
}

function FolderRootBottomDropZone({ isActive }: { isActive: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: folderRootBottomId,
    data: { type: 'folder-root-bottom' },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'relative h-5 transition-colors',
        (isActive || isOver) && 'bg-primary/5',
      )}
      aria-hidden
    >
      {isActive && (
        <div className="pointer-events-none absolute left-1 right-1 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.55)]" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: droppable "unfiled" root zone for meetings
// ---------------------------------------------------------------------------

function UnfiledDropZone({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'meeting-root',
    data: { type: 'meeting-root-target' },
  });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[2rem] rounded-md transition-colors ${isOver ? 'bg-primary/10 ring-1 ring-primary/30' : ''}`}
    >
      {children}
    </div>
  );
}

export default Sidebar;
