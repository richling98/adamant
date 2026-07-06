"use client"

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import debounce from "lodash/debounce";
import { toast } from "sonner";
import "@blocknote/shadcn/style.css";
import type { Todo } from "@/types";
import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import { addDaysToDateKey, localDateKey } from "@/lib/dateKey";
import {
  getTodosByDate,
  toggleTodo as apiToggleTodo,
  deleteTodo as apiDeleteTodo,
  createTodo as apiCreateTodo,
  updateTodo as apiUpdateTodo,
} from "@/lib/todoApi";

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function subtractDay(dateStr: string): string {
  return addDaysToDateKey(dateStr, -1);
}

function addDay(dateStr: string): string {
  return addDaysToDateKey(dateStr, 1);
}

export function TodosPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { fetchTodoDates } = useSidebar();
  const dateParam = searchParams.get("date");
  const todayStr = localDateKey();
  const activeDate = dateParam || todayStr;
  const isToday = activeDate === todayStr;

  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTodos = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getTodosByDate(activeDate);
      setTodos(data);
    } catch (e) {
      toast.error("Failed to load to-dos");
    } finally {
      setLoading(false);
    }
  }, [activeDate]);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  const handleToggle = async (id: string, checked: boolean) => {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, is_checked: checked } : t)),
    );
    try {
      await apiToggleTodo(id, checked);
      fetchTodoDates();
    } catch (e) {
      setTodos((prev) =>
        prev.map((t) => (t.id === id ? { ...t, is_checked: !checked } : t)),
      );
      toast.error("Failed to update to-do");
    }
  };

  const handleDelete = async (id: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
    try {
      await apiDeleteTodo(id);
      fetchTodoDates();
    } catch (e) {
      fetchTodos();
      toast.error("Failed to delete to-do");
    }
  };

  const handleUpdate = async (id: string, markdown: string, json: string) => {
    try {
      await apiUpdateTodo(id, json, markdown);
    } catch (e) {
      toast.error("Failed to save to-do");
    }
  };

  const handleAdd = async (markdown: string, json: string) => {
    try {
      const newTodo = await apiCreateTodo(null, activeDate, json, markdown);
      setTodos((prev) => [...prev, newTodo]);
      fetchTodoDates();
    } catch (e) {
      toast.error("Failed to create to-do");
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto animate-pulse">
        <div className="h-8 w-48 bg-zinc-800 rounded mb-6" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-3 py-2">
            <div className="w-4 h-4 bg-zinc-800 rounded mt-0.5" />
            <div className="flex-1 h-6 bg-zinc-800 rounded" />
          </div>
        ))}
      </div>
    );
  }

  const unchecked = todos.filter((t) => !t.is_checked);
  const checked = todos.filter((t) => t.is_checked);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => router.back()}
          className="text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/todos?date=${subtractDay(activeDate)}`)}
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-semibold text-zinc-100">
            {formatDateLabel(activeDate)}
          </h1>
          <button
            onClick={() => router.push(`/todos?date=${addDay(activeDate)}`)}
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        {!isToday ? (
          <button
            onClick={() => router.push("/todos")}
            className="text-sm text-emerald-500 hover:text-emerald-400 transition-colors"
          >
            Today
          </button>
        ) : (
          <div className="w-16" />
        )}
      </div>

      {/* Empty state */}
      {todos.length === 0 && (
        <div className="text-center py-16 text-zinc-500">
          <p className="text-sm">No to-dos for {formatDateLabel(activeDate)}</p>
          <p className="text-xs mt-1">
            Run AI cleanup on a meeting to extract action items, or add one
            manually.
          </p>
        </div>
      )}

      {/* Add todo row */}
      <AddTodoRow onAdd={handleAdd} />

      {/* Unchecked todos */}
      <div className="space-y-1">
        {unchecked.map((todo) => (
          <TodoRow
            key={todo.id}
            todo={todo}
            onToggle={handleToggle}
            onDelete={handleDelete}
            onUpdate={handleUpdate}
          />
        ))}
      </div>

      {/* Completed section */}
      {checked.length > 0 && (
        <div className="mt-4">
          <div className="border-t border-zinc-800 pt-3 mb-2">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">
              Completed
            </span>
          </div>
          <div className="space-y-1">
            {checked.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onUpdate={handleUpdate}
              />
            ))}
          </div>
        </div>
      )}

      {/* Stats bar */}
      {todos.length > 0 && (
        <div className="mt-6 text-xs text-zinc-600">
          {unchecked.length} unchecked &middot; {checked.length} completed
        </div>
      )}
    </div>
  );
}

function TodoRow({
  todo,
  onToggle,
  onDelete,
  onUpdate,
}: {
  todo: Todo;
  onToggle: (id: string, checked: boolean) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, markdown: string, json: string) => void;
}) {
  const router = useRouter();
  const editorRef = useRef<HTMLDivElement>(null);
  const isLoadingContent = useRef(false);

  // Extracted todos store text in content_markdown/source_text but have
  // content_json = null. We need to load the markdown into the BlockNote
  // editor so the to-do text is visible (not a blank editor).
  const displayMarkdown = todo.content_json
    ? null
    : (todo.content_markdown || todo.source_text || "").trim();

  const initialContent = todo.content_json
    ? (JSON.parse(todo.content_json) as any[])
    : undefined;

  const editor = useCreateBlockNote({
    initialContent: initialContent as any,
  });

  // When content_json is null but we have markdown text, parse it into
  // BlockNote blocks and load them into the editor. This is the same
  // pattern used in BlockNoteSummaryView.tsx and BasicBlockNoteTest.tsx.
  useEffect(() => {
    if (!displayMarkdown) return;

    let cancelled = false;
    const loadMarkdown = async () => {
      try {
        const blocks = await editor.tryParseMarkdownToBlocks(displayMarkdown);
        if (!cancelled && blocks.length > 0) {
          // Guard: prevent the onChange fired by replaceBlocks from
          // triggering a save back to the database.
          isLoadingContent.current = true;
          editor.replaceBlocks(editor.document, blocks);
          setTimeout(() => {
            isLoadingContent.current = false;
          }, 0);
        }
      } catch (err) {
        console.error("Failed to parse todo markdown to blocks:", err);
      }
    };
    loadMarkdown();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, displayMarkdown]);

  const debouncedSave = useRef(
    debounce(async () => {
      if (isLoadingContent.current) return;
      const markdown = await editor.blocksToMarkdownLossy();
      if (!markdown?.trim()) return;
      const json = JSON.stringify(editor.document);
      onUpdate(todo.id, markdown, json);
    }, 2000),
  ).current;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      const editorEl = editorRef.current?.querySelector(".bn-editor") as HTMLElement | null;
      editorEl?.focus();
    }
    if (e.key === "Escape") {
      const editorEl = editorRef.current?.querySelector(".bn-editor") as HTMLElement | null;
      if (editorEl && document.activeElement && editorEl.contains(document.activeElement)) {
        (document.activeElement as HTMLElement).blur();
      }
    }
  };

  return (
    <div
      className={`flex items-start gap-3 py-1.5 group ${
        todo.is_checked ? "opacity-50" : ""
      }`}
      onKeyDown={handleKeyDown}
    >
      <input
        type="checkbox"
        checked={todo.is_checked}
        onChange={() => onToggle(todo.id, !todo.is_checked)}
        className="mt-1 accent-emerald-500 cursor-pointer shrink-0"
      />
      <div className="flex-1 min-w-0" ref={editorRef}>
        <div className={todo.is_checked ? "line-through text-zinc-500" : ""}>
          <BlockNoteView
            editor={editor}
            theme="dark"
            className="todo-editor"
            onChange={() => {
              if (!isLoadingContent.current) {
                debouncedSave();
              }
            }}
          />
        </div>
        {todo.meeting_id && todo.meeting_title && (
          <button
            onClick={() =>
              router.push(`/meeting-details?id=${todo.meeting_id}`)
            }
            className="text-xs text-zinc-500 hover:text-emerald-400 transition-colors mt-0.5"
          >
            from {todo.meeting_title} ↗
          </button>
        )}
      </div>
      <button
        onClick={() => onDelete(todo.id)}
        className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-opacity p-1"
        aria-label="Delete to-do"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function AddTodoRow({
  onAdd,
}: {
  onAdd: (markdown: string, json: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const editor = useCreateBlockNote({
    placeholders: { default: "Add a to-do..." },
  });

  const handleSubmit = async () => {
    const markdown = await editor.blocksToMarkdownLossy();
    const json = JSON.stringify(editor.document);
    if (markdown.trim() && markdown !== "Add a to-do...") {
      onAdd(markdown, json);
      editor.replaceBlocks(editor.document, [
        { id: "1", type: "paragraph", content: [] },
      ]);
      setIsEditing(false);
    }
  };

  if (!isEditing) {
    return (
      <button
        onClick={() => setIsEditing(true)}
        className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors py-2"
      >
        <Plus className="w-4 h-4" />
        Add a to-do
      </button>
    );
  }

  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="w-4 h-4 mt-1 rounded border border-zinc-600 shrink-0" />
      <div className="flex-1">
        <BlockNoteView
          editor={editor}
          theme="dark"
          className="todo-editor"
        />
      </div>
      <button
        onClick={handleSubmit}
        className="text-xs text-emerald-500 hover:text-emerald-400 transition-colors mt-1"
      >
        Add
      </button>
      <button
        onClick={() => setIsEditing(false)}
        className="text-xs text-zinc-500 hover:text-zinc-400 transition-colors mt-1"
      >
        Cancel
      </button>
    </div>
  );
}
