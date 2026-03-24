'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight, File, Settings, ChevronLeftCircle, ChevronRightCircle, Calendar, StickyNote, Home, Trash2, Plus, Search, Pencil, NotebookPen, SearchIcon, X, FolderPlus, Square, CheckSquare } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useSidebar } from './SidebarProvider';
import type { CurrentMeeting } from '@/components/Sidebar/SidebarProvider';
import { FolderItem } from './FolderItem';
import { DndContext, useDroppable, useDraggable, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
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

interface SidebarItem {
  id: string;
  title: string;
  type: 'folder' | 'file';
  children?: SidebarItem[];
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
    moveMeetingToFolder,
    refetchMeetings,
  } = useSidebar();

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['meetings']));
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: 'ollama',
    model: '',
    whisperModel: '',
    apiKey: null,
    ollamaEndpoint: null
  });
  const [transcriptModelConfig, setTranscriptModelConfig] = useState<TranscriptModelProps>({
    provider: 'parakeet',
    model: 'parakeet-tdt-0.6b-v3-int8',
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
  // Controls visibility of the "+" button on the "Meeting Notes" section header
  const [isMeetingNotesHeaderHovered, setIsMeetingNotesHeaderHovered] = useState(false);
  // Loading guard for unfiled note creation — prevents double-creation on rapid clicks
  const [isCreatingUnfiled, setIsCreatingUnfiled] = useState(false);

  // New folder creation inline state
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  // Require 8px of movement before drag activates — prevents click events from
  // briefly triggering drop-zone highlights (blue flash on meeting row clicks).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Handle drag-and-drop: move a meeting to a folder or back to root
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const meetingId = active.id as string;
    const targetId = over.id as string;
    // 'root' drop zone = unfile the meeting
    await moveMeetingToFolder(meetingId, targetId === 'root' ? null : targetId);
  }, [moveMeetingToFolder]);

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
        console.log('Waiting for server address to load before fetching model config');
        return;
      }

      try {
        const data = await invoke('api_get_model_config') as any;
        if (data && data.provider !== null) {
          // Fetch API key if not included and provider requires it
          if (data.provider !== 'ollama' && !data.apiKey) {
            try {
              const apiKeyData = await invoke('api_get_api_key', {
                provider: data.provider
              }) as string;
              data.apiKey = apiKeyData;
            } catch (err) {
              console.error('Failed to fetch API key:', err);
            }
          }
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
        console.log('Waiting for server address to load before fetching transcript settings');
        return;
      }

      try {
        const data = await invoke('api_get_transcript_config') as any;
        if (data && data.provider !== null) {
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
        console.log('Sidebar received model-config-updated event:', event.payload);
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
        apiKey: config.apiKey,
        ollamaEndpoint: config.ollamaEndpoint,
      });

      setModelConfig(config);
      console.log('Model config saved successfully');
      setSettingsSaveSuccess(true);

      // Emit event to sync other components
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', config);

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
      console.log('Saving transcript config with payload:', payload);

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
    if (!value.trim()) return;

    // Search through transcripts
    await searchTranscripts(value);

    // Make sure the meetings folder is expanded when searching
    if (!expandedFolders.has('meetings')) {
      const newExpanded = new Set(expandedFolders);
      newExpanded.add('meetings');
      setExpandedFolders(newExpanded);
    }
  }, [expandedFolders, searchTranscripts]);

  // Combine search results with sidebar items
  const filteredSidebarItems = useMemo(() => {
    if (!searchQuery.trim()) return sidebarItems;

    // If we have search results, highlight matching meetings
    if (searchResults.length > 0) {
      // Get the IDs of meetings that matched in transcripts
      const matchedMeetingIds = new Set(searchResults.map(result => result.id));

      return sidebarItems
        .map(folder => {
          // Always include folders in the results
          if (folder.type === 'folder') {
            if (!folder.children) return folder;

            // Filter children based on search results or title match
            const filteredChildren = folder.children.filter(item => {
              // Include if the meeting ID is in our search results
              if (matchedMeetingIds.has(item.id)) return true;

              // Or if the title matches the search query
              return item.title.toLowerCase().includes(searchQuery.toLowerCase());
            });

            return {
              ...folder,
              children: filteredChildren
            };
          }

          // For non-folder items, check if they match the search
          return (matchedMeetingIds.has(folder.id) ||
            folder.title.toLowerCase().includes(searchQuery.toLowerCase()))
            ? folder : undefined;
        })
        .filter((item): item is SidebarItem => item !== undefined); // Type-safe filter
    } else {
      // Fall back to title-only filtering if no transcript results
      return sidebarItems
        .map(folder => {
          // Always include folders in the results
          if (folder.type === 'folder') {
            if (!folder.children) return folder;

            // Filter children based on search query
            const filteredChildren = folder.children.filter(item =>
              item.title.toLowerCase().includes(searchQuery.toLowerCase())
            );

            return {
              ...folder,
              children: filteredChildren
            };
          }

          // For non-folder items, check if they match the search
          return folder.title.toLowerCase().includes(searchQuery.toLowerCase()) ? folder : undefined;
        })
        .filter((item): item is SidebarItem => item !== undefined); // Type-safe filter
    }
  }, [sidebarItems, searchQuery, searchResults, expandedFolders]);


  const handleDelete = async (itemId: string) => {
    console.log('Deleting item:', itemId);
    const payload = {
      meetingId: itemId
    };

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('api_delete_meeting', {
        meetingId: itemId,
      });
      console.log('Meeting deleted successfully');
      const updatedMeetings = meetings.filter((m: CurrentMeeting) => m.id !== itemId);
      setMeetings(updatedMeetings);

      // Track meeting deletion
      Analytics.trackMeetingDeleted(itemId);

      // Show success toast
      toast.success("Meeting deleted successfully", {
        description: "All associated data has been removed"
      });

      // If deleting the active meeting, navigate to home
      if (currentMeeting?.id === itemId) {
        setCurrentMeeting({ id: 'intro-call', title: '+ New Call' });
        router.push('/');
      }
    } catch (error) {
      console.error('Failed to delete meeting:', error);
      toast.error("Failed to delete meeting", {
        description: error instanceof Error ? error.message : String(error)
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
    let successCount = 0;

    for (const id of idsToDelete) {
      try {
        await invoke('api_delete_meeting', { meetingId: id });
        Analytics.trackMeetingDeleted(id);
        successCount++;
      } catch (error) {
        console.error(`Failed to delete meeting ${id}:`, error);
      }
    }

    // Remove deleted meetings from local state
    setMeetings(meetings.filter((m: CurrentMeeting) => !idsToDelete.includes(m.id)));

    // If the currently-open meeting was deleted, navigate home
    if (currentMeeting?.id && idsToDelete.includes(currentMeeting.id)) {
      setCurrentMeeting({ id: 'intro-call', title: '+ New Call' });
      router.push('/');
    }

    clearSelection();
    setBulkDeleteModalOpen(false);

    toast.success(`${successCount} meeting${successCount !== 1 ? 's' : ''} deleted`, {
      description: 'All associated data has been removed',
    });
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

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => router.push('/settings')}
                onMouseEnter={() => setHoverCollapsedSettings(true)}
                onMouseLeave={() => setHoverCollapsedSettings(false)}
                className="p-2 rounded-xl transition-all duration-300"
                style={{
                  background: isSettingsPage || hoverCollapsedSettings ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  border: `1px solid ${hoverCollapsedSettings ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.12)'}`,
                  boxShadow: hoverCollapsedSettings
                    ? '0 0 16px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.12)'
                    : 'inset 0 1px 0 rgba(255,255,255,0.06)',
                  transform: hoverCollapsedSettings ? 'scale(1.06)' : 'scale(1)',
                }}
              >
                <Settings className="w-5 h-5 text-foreground/75" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Settings</p>
            </TooltipContent>
          </Tooltip>

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

              {/* Show transcript match snippet if available */}
              {hasTranscriptMatch && (
                <div className="mt-1 ml-8 text-xs text-emerald-200/90 bg-emerald-500/10 p-1.5 rounded border border-emerald-400/20 line-clamp-2">
                  <span className="font-medium text-emerald-300">Match:</span> {matchingResult.matchContext}
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
            {!isCollapsed && (
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

            {!isCollapsed && (
              <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 px-3 pb-4">

                  {/* ── Folders section ── */}
                  <div className="flex items-center justify-between h-8 mt-3 mb-1">
                    <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Folders</span>
                    <button
                      className="p-1 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors"
                      title="New folder"
                      onClick={() => {
                        setIsCreatingFolder(true);
                        setNewFolderName('');
                        setTimeout(() => newFolderInputRef.current?.focus(), 0);
                      }}
                    >
                      <FolderPlus className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Inline new-folder input */}
                  {isCreatingFolder && (
                    <div className="flex items-center gap-1 mb-1 px-2 py-1 bg-white/5 rounded-md">
                      <input
                        ref={newFolderInputRef}
                        className="flex-1 bg-transparent text-sm text-white outline-none border-b border-blue-500"
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

                  {/* User-created folder rows */}
                  {folders.map((folder) => {
                    // Compute children directly from `meetings` (which has accurate folder_id values).
                    // filteredSidebarItems only contains top-level items — filed meetings are nested
                    // inside folder children there and would never be found by a flat filter.
                    const folderMeetings: SidebarItem[] = meetings
                      .filter((m) => m.folder_id === folder.id)
                      .filter((m) =>
                        !searchQuery.trim() ||
                        m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        searchResults.some((r) => r.id === m.id)
                      )
                      .map((m) => ({ id: m.id, title: m.title, type: 'file' as const }));
                    return (
                      <FolderItem
                        key={folder.id}
                        folder={folder}
                        children={folderMeetings}
                        isSidebarCollapsed={isCollapsed}
                        activeMeetingId={currentMeeting?.id}
                        renderMeetingItem={(item, insideFolder) => (
                          <DraggableMeetingRow
                            key={item.id}
                            item={item}
                            isActive={currentMeeting?.id === item.id}
                            indent={insideFolder}
                            isSelected={selectedMeetingIds.has(item.id)}
                            onToggleSelect={(e) => toggleMeetingSelection(item.id, e)}
                            onNavigate={() => {
                              setCurrentMeeting({ id: item.id, title: item.title });
                              router.push(`/meeting-details?id=${item.id}`);
                            }}
                            onEdit={() => handleEditStart(item.id, item.title)}
                            onDelete={() => setDeleteModalState({ isOpen: true, itemId: item.id })}
                          />
                        )}
                      />
                    );
                  })}

                  {/* ── Meeting Notes (unfiled) section ── */}
                  <div
                    className="flex items-center justify-between h-8 mt-4 mb-1"
                    onMouseEnter={() => setIsMeetingNotesHeaderHovered(true)}
                    onMouseLeave={() => setIsMeetingNotesHeaderHovered(false)}
                  >
                    <div className="flex items-center">
                      <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Meeting Notes</span>
                      {searchQuery && isSearching && (
                        <span className="ml-2 text-xs text-emerald-300 animate-pulse">Searching…</span>
                      )}
                    </div>
                    {/* New unfiled note — eagerly created in DB, then navigate to real ID */}
                    {isMeetingNotesHeaderHovered && (
                      <button
                        className="p-0.5 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title="New meeting note"
                        disabled={isCreatingUnfiled}
                        onClick={async () => {
                          if (isCreatingUnfiled) return;
                          setIsCreatingUnfiled(true);
                          try {
                            const now = new Date();
                            const title = `${now.getMonth() + 1}-${now.getDate()}-${String(now.getFullYear()).slice(-2)} new note`;
                            const meeting = await invoke<{ id: string }>('api_create_meeting', { title });
                            // Refresh sidebar so the new note appears immediately
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
                    )}
                  </div>

                  {/* Unfiled droppable root zone */}
                  <UnfiledDropZone>
                    {filteredSidebarItems
                      .filter((item) => item.type === 'file' && !meetings.find((m) => m.id === item.id)?.folder_id)
                      .map((item) => (
                        <DraggableMeetingRow
                          key={item.id}
                          item={item}
                          isActive={currentMeeting?.id === item.id}
                          indent={false}
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
                  </UnfiledDropZone>

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
            <button
              onClick={() => router.push('/settings')}
              onMouseEnter={() => setHoverExpandedSettings(true)}
              onMouseLeave={() => setHoverExpandedSettings(false)}
              className="w-full flex items-center justify-center px-3 py-1.5 mt-1 mb-1 text-sm font-medium rounded-xl transition-all duration-300"
              style={{
                background: hoverExpandedSettings ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                border: `1px solid ${hoverExpandedSettings ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)'}`,
                color: hoverExpandedSettings ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.75)',
                boxShadow: hoverExpandedSettings
                  ? '0 4px 20px rgba(0,0,0,0.16), 0 0 14px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.14)'
                  : '0 2px 16px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.08)',
                transform: hoverExpandedSettings ? 'translateY(-1px)' : 'translateY(0)',
              }}
            >
              <Settings className="w-4 h-4 mr-2" />
              <span>Settings</span>
            </button>
            <div className="w-full flex items-center justify-center px-3 py-1 text-xs text-foreground/45">
              v0.2.0
            </div>
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
// Helper: draggable meeting row
// ---------------------------------------------------------------------------

interface DraggableMeetingRowProps {
  item: SidebarItem;
  isActive: boolean;
  indent?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (e: React.MouseEvent) => void;
  onNavigate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function DraggableMeetingRow({ item, isActive, indent, isSelected, onToggleSelect, onNavigate, onEdit, onDelete }: DraggableMeetingRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.5 : 1 }
    : undefined;

  return (
    <div
      ref={setNodeRef}
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
// Helper: droppable "unfiled" root zone
// ---------------------------------------------------------------------------

function UnfiledDropZone({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'root' });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[2rem] rounded-md transition-colors ${isOver ? 'bg-blue-500/10 ring-1 ring-blue-500/30' : ''}`}
    >
      {children}
    </div>
  );
}

export default Sidebar;
