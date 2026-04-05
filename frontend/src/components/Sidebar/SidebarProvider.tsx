'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';


interface SidebarItem {
  id: string;
  title: string;
  type: 'folder' | 'file';
  children?: SidebarItem[];
  /** Present on type='folder' items so FolderItem can render its own actions. */
  folderData?: Folder;
}

export interface CurrentMeeting {
  id: string;
  title: string;
  /** ISO 8601 creation timestamp — used by the "By Date" sidebar grouping. */
  created_at?: string;
  /** FK into the folders table. Undefined / null means the meeting is unfiled. */
  folder_id?: string | null;
}

/** A user-created folder returned by the Rust backend. */
export interface Folder {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  parent_id?: string | null;
}

// Keyword search result — FTS5 across title, transcript, notes, and AI summary.
// matchSource: "transcript" | "notes" | "summary" | "title"
interface TranscriptSearchResult {
  id: string;
  title: string;
  matchContext: string;
  timestamp: string;
  matchSource?: string;
  matchType?: string;
  score?: number;
}

interface SidebarContextType {
  currentMeeting: CurrentMeeting | null;
  setCurrentMeeting: (meeting: CurrentMeeting | null) => void;
  sidebarItems: SidebarItem[];
  isCollapsed: boolean;
  toggleCollapse: () => void;
  meetings: CurrentMeeting[];
  setMeetings: (meetings: CurrentMeeting[]) => void;
  isMeetingActive: boolean;
  setIsMeetingActive: (active: boolean) => void;
  handleRecordingToggle: () => void;
  /** True while the user has a note-taking session open (pencil flow).
   *  Set by meeting-details/page.tsx when showRecordingControls becomes true. */
  isNoteSessionActive: boolean;
  setNoteSessionActive: (active: boolean) => void;
  searchTranscripts: (query: string) => Promise<void>;
  searchResults: TranscriptSearchResult[];
  isSearching: boolean;
  setServerAddress: (address: string) => void;
  serverAddress: string;
  transcriptServerAddress: string;
  setTranscriptServerAddress: (address: string) => void;
  // Summary polling management
  activeSummaryPolls: Map<string, NodeJS.Timeout>;
  startSummaryPolling: (meetingId: string, processId: string, onUpdate: (result: any) => void) => void;
  stopSummaryPolling: (meetingId: string) => void;
  // Refetch meetings from backend
  refetchMeetings: () => Promise<void>;
  // Folder management
  folders: Folder[];
  fetchFolders: () => Promise<void>;
  createFolder: (name: string, parentId?: string | null) => Promise<Folder>;
  renameFolder: (folderId: string, name: string) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  moveMeetingToFolder: (meetingId: string, folderId: string | null) => Promise<void>;
  /** Set before navigating to a new meeting so it gets auto-assigned to a folder. */
  pendingFolderId: string | null;
  setPendingFolderId: (id: string | null) => void;
}

const SidebarContext = createContext<SidebarContextType | null>(null);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
};

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [currentMeeting, setCurrentMeeting] = useState<CurrentMeeting | null>({ id: 'intro-call', title: '+ New Call' });
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [meetings, setMeetings] = useState<CurrentMeeting[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [sidebarItems, setSidebarItems] = useState<SidebarItem[]>([]);
  const [isMeetingActive, setIsMeetingActive] = useState(false);
  const [searchResults, setSearchResults] = useState<TranscriptSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // Refs for debounce and stale-result guard
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQueryRef = useRef<string>('');
  const [serverAddress, setServerAddress] = useState('');
  const [transcriptServerAddress, setTranscriptServerAddress] = useState('');
  const [activeSummaryPolls, setActiveSummaryPolls] = useState<Map<string, NodeJS.Timeout>>(new Map());
  /** When set, the next newly created meeting will be auto-assigned to this folder. */
  const [pendingFolderId, setPendingFolderId] = useState<string | null>(null);

  // Tracks whether the user has an active note-taking session open (pencil flow).
  // Set by meeting-details/page.tsx when showRecordingControls becomes true.
  const [isNoteSessionActive, setNoteSessionActive] = useState(false);

  const pathname = usePathname();
  const router = useRouter();

  // Fetch all folders from the backend.
  const fetchFolders = React.useCallback(async () => {
    try {
      const data = await invoke('api_get_folders') as Folder[];
      setFolders(data);
    } catch (error) {
      console.error('Error fetching folders:', error);
      setFolders([]);
    }
  }, []);

  // Extract fetchMeetings as a reusable function.
  // Preserves folder_id so meetings can be grouped under their folder.
  const fetchMeetings = React.useCallback(async () => {
    if (serverAddress) {
      try {
        const data = await invoke('api_get_meetings') as Array<{ id: string; title: string; created_at?: string; folder_id?: string | null }>;
        const transformed: CurrentMeeting[] = data.map((m) => ({
          id: m.id,
          title: m.title,
          created_at: m.created_at,
          folder_id: m.folder_id ?? null,
        }));
        setMeetings(transformed);
        Analytics.trackBackendConnection(true);
      } catch (error) {
        console.error('Error fetching meetings:', error);
        setMeetings([]);
        Analytics.trackBackendConnection(false, error instanceof Error ? error.message : 'Unknown error');
      }
    }
  }, [serverAddress]);

  useEffect(() => {
    fetchMeetings();
    fetchFolders();
  }, [serverAddress, fetchMeetings, fetchFolders]);

  // Folder CRUD helpers — each refreshes both meetings and folders after mutation.

  const createFolder = React.useCallback(async (name: string, parentId?: string | null): Promise<Folder> => {
    const folder = await invoke('api_create_folder', { name, parentId: parentId ?? null }) as Folder;
    await fetchFolders();
    return folder;
  }, [fetchFolders]);

  const renameFolder = React.useCallback(async (folderId: string, name: string): Promise<void> => {
    await invoke('api_rename_folder', { folderId, name });
    await fetchFolders();
  }, [fetchFolders]);

  const deleteFolder = React.useCallback(async (folderId: string): Promise<void> => {
    await invoke('api_delete_folder', { folderId });
    // Meetings inside the deleted folder become unfiled — refresh both.
    await Promise.all([fetchFolders(), fetchMeetings()]);
  }, [fetchFolders, fetchMeetings]);

  const moveMeetingToFolder = React.useCallback(async (meetingId: string, folderId: string | null): Promise<void> => {
    await invoke('api_move_meeting_to_folder', { meetingId, folderId });
    await Promise.all([fetchFolders(), fetchMeetings()]);
  }, [fetchFolders, fetchMeetings]);

  useEffect(() => {
    const fetchSettings = async () => {
      setServerAddress('http://localhost:5167');
      setTranscriptServerAddress('http://127.0.0.1:8178/stream');
    };
    fetchSettings();
  }, []);

  // Build sidebar items recursively. Each folder item carries its own meetings
  // as children, followed by any subfolders (which themselves carry their meetings).
  const buildSidebarItems = React.useCallback((): SidebarItem[] => {
    const buildFolderTree = (parentId: string | null): SidebarItem[] => {
      return folders
        .filter((f) => (f.parent_id ?? null) === parentId)
        .map((folder) => ({
          id: folder.id,
          title: folder.name,
          type: 'folder' as const,
          folderData: folder,
          children: [
            // Subfolders first (recursive)
            ...buildFolderTree(folder.id),
            // Then meetings directly in this folder
            ...meetings
              .filter((m) => m.folder_id === folder.id)
              .map((m) => ({ id: m.id, title: m.title, type: 'file' as const })),
          ],
        }));
    };

    const unfiledItems: SidebarItem[] = meetings
      .filter((m) => !m.folder_id)
      .map((m) => ({ id: m.id, title: m.title, type: 'file' as const }));

    return [...buildFolderTree(null), ...unfiledItems];
  }, [folders, meetings]);


  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  // Update current meeting when on home page
  useEffect(() => {
    if (pathname === '/') {
      setCurrentMeeting({ id: 'intro-call', title: '+ New Call' });
    }
    setSidebarItems(buildSidebarItems());
  }, [pathname]);

  // Rebuild sidebar items whenever meetings or folders change
  useEffect(() => {
    setSidebarItems(buildSidebarItems());
  }, [meetings, folders, buildSidebarItems]);

  // Function to handle recording toggle from sidebar.
  // The recording button only appears when the user is on an active meeting page,
  // so this always dispatches to the current meeting page via DOM event.
  // Stop is handled directly in Sidebar/index.tsx via useRecordingStop to avoid
  // a circular dependency (useRecordingStop internally calls useSidebar).
  const handleRecordingToggle = () => {
    // Dispatch to the active meeting page to start recording there.
    window.dispatchEvent(new CustomEvent('start-recording-on-note'));
    Analytics.trackButtonClick('start_recording', 'sidebar');
  };


  // Unified meeting search with 300ms debounce and stale-result guard.
  //
  // Debounce prevents firing on every keystroke.
  // Stale-result guard: the Tauri invoke is async; if the user types quickly
  // the responses can arrive out-of-order.  We only apply a response if the
  // query that triggered it is still the latest one.
  const searchTranscripts = useCallback((query: string) => {
    // Clear any pending debounce timer
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    if (!query.trim()) {
      latestQueryRef.current = '';
      setSearchResults([]);
      setIsSearching(false);
      return Promise.resolve();
    }

    setIsSearching(true);

    return new Promise<void>((resolve) => {
      searchDebounceRef.current = setTimeout(async () => {
        const thisQuery = query;
        latestQueryRef.current = thisQuery;

        try {
          const results = await invoke('api_search_transcripts', { query: thisQuery }) as TranscriptSearchResult[];

          // Stale-result guard: discard if a newer query was issued while we awaited
          if (latestQueryRef.current === thisQuery) {
            setSearchResults(results);
          }
        } catch (error) {
          console.error('Error searching transcripts:', error);
          if (latestQueryRef.current === thisQuery) {
            setSearchResults([]);
          }
        } finally {
          if (latestQueryRef.current === thisQuery) {
            setIsSearching(false);
          }
        }
        resolve();
      }, 300);
    });
  }, []);

  // Summary polling management
  const startSummaryPolling = React.useCallback((
    meetingId: string,
    processId: string,
    onUpdate: (result: any) => void
  ) => {
    // Stop existing poll for this meeting if any
    if (activeSummaryPolls.has(meetingId)) {
      clearInterval(activeSummaryPolls.get(meetingId)!);
    }

    console.debug(`📊 Starting polling for meeting ${meetingId}, process ${processId}`);

    let pollCount = 0;
    const MAX_POLLS = 200; // ~16.5 minutes at 5-second intervals (slightly longer than backend's 15-min timeout to avoid race conditions)

    const pollInterval = setInterval(async () => {
      pollCount++;

      // Timeout safety: Stop after 10 minutes
      if (pollCount >= MAX_POLLS) {
        console.warn(`⏱️ Polling timeout for ${meetingId} after ${MAX_POLLS} iterations`);
        clearInterval(pollInterval);
        setActiveSummaryPolls(prev => {
          const next = new Map(prev);
          next.delete(meetingId);
          return next;
        });
        onUpdate({
          status: 'error',
          error: 'Summary generation timed out after 15 minutes. Please try again or check your model configuration.'
        });
        return;
      }
      try {
        const result = await invoke('api_get_summary', {
          meetingId: meetingId,
        }) as any;

        console.debug(`📊 Polling update for ${meetingId}:`, result.status);

        // Call the update callback with result
        onUpdate(result);

        // Stop polling if completed, error, failed, cancelled, or idle (after initial processing)
        if (result.status === 'completed' || result.status === 'error' || result.status === 'failed' || result.status === 'cancelled') {
          console.debug(`Polling completed for ${meetingId}, status: ${result.status}`);
          clearInterval(pollInterval);
          setActiveSummaryPolls(prev => {
            const next = new Map(prev);
            next.delete(meetingId);
            return next;
          });
        } else if (result.status === 'idle' && pollCount > 1) {
          // If we get 'idle' after polling started, process completed/disappeared
          console.debug(`Process completed or not found for ${meetingId}, stopping poll`);
          clearInterval(pollInterval);
          setActiveSummaryPolls(prev => {
            const next = new Map(prev);
            next.delete(meetingId);
            return next;
          });
        }
      } catch (error) {
        console.error(`Polling error for ${meetingId}:`, error);
        // Report error to callback
        onUpdate({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        clearInterval(pollInterval);
        setActiveSummaryPolls(prev => {
          const next = new Map(prev);
          next.delete(meetingId);
          return next;
        });
      }
    }, 5000); // Poll every 5 seconds

    setActiveSummaryPolls(prev => new Map(prev).set(meetingId, pollInterval));
  }, [activeSummaryPolls]);

  const stopSummaryPolling = React.useCallback((meetingId: string) => {
    const pollInterval = activeSummaryPolls.get(meetingId);
    if (pollInterval) {
      console.debug(`⏹️ Stopping polling for meeting ${meetingId}`);
      clearInterval(pollInterval);
      setActiveSummaryPolls(prev => {
        const next = new Map(prev);
        next.delete(meetingId);
        return next;
      });
    }
  }, [activeSummaryPolls]);

  // Cleanup all polling intervals on unmount
  useEffect(() => {
    return () => {
      console.debug('🧹 Cleaning up all summary polling intervals');
      activeSummaryPolls.forEach(interval => clearInterval(interval));
    };
  }, [activeSummaryPolls]);



  return (
    <SidebarContext.Provider value={{
      currentMeeting,
      setCurrentMeeting,
      sidebarItems,
      isCollapsed,
      toggleCollapse,
      meetings,
      setMeetings,
      isMeetingActive,
      setIsMeetingActive,
      handleRecordingToggle,
      isNoteSessionActive,
      setNoteSessionActive,
      searchTranscripts,
      searchResults,
      isSearching,
      setServerAddress,
      serverAddress,
      transcriptServerAddress,
      setTranscriptServerAddress,
      activeSummaryPolls,
      startSummaryPolling,
      stopSummaryPolling,
      refetchMeetings: fetchMeetings,
      // Folder management
      folders,
      fetchFolders,
      createFolder,
      renameFolder,
      deleteFolder,
      moveMeetingToFolder,
      pendingFolderId,
      setPendingFolderId,
    }}>
      {children}
    </SidebarContext.Provider>
  );
}
