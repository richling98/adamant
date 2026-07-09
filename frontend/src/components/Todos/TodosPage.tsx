"use client"

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import debounce from "lodash/debounce";
import { toast } from "sonner";
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

function extractPlainTextFromJson(contentJson: string | null | undefined): string {
  if (!contentJson) return "";

  try {
    const blocks = JSON.parse(contentJson);
    const parts: string[] = [];

    const walk = (node: any): void => {
      if (!node) return;
      if (typeof node === "string") {
        const trimmed = node.trim();
        if (trimmed) parts.push(trimmed);
        return;
      }

      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }

      if (typeof node !== "object") return;

      if (typeof node.content === "string") {
        const trimmed = node.content.trim();
        if (trimmed) parts.push(trimmed);
      } else if (Array.isArray(node.content)) {
        node.content.forEach(walk);
      }

      if (Array.isArray(node.children)) {
        node.children.forEach(walk);
      }
    };

    walk(blocks);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
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

  const handleUpdate = async (id: string, markdown: string, json: string | null) => {
    try {
      await apiUpdateTodo(id, json, markdown);
    } catch (e) {
      toast.error("Failed to save to-do");
    }
  };

  const handleAdd = async (markdown: string, json: string | null) => {
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
      <div className="min-h-screen bg-background p-6 max-w-3xl mx-auto animate-pulse">
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
    <div className="min-h-screen bg-background p-6 max-w-3xl mx-auto">
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
  onUpdate: (id: string, markdown: string, json: string | null) => void;
}) {
  const router = useRouter();
  const initialText = (
    todo.content_markdown ||
    todo.source_text ||
    extractPlainTextFromJson(todo.content_json) ||
    ""
  ).trim();
  const [text, setText] = useState(initialText);
  const lastSavedTextRef = useRef(initialText);

  useEffect(() => {
    const nextText = (
      todo.content_markdown ||
      todo.source_text ||
      extractPlainTextFromJson(todo.content_json) ||
      ""
    ).trim();
    setText(nextText);
    lastSavedTextRef.current = nextText;
  }, [todo.content_json, todo.content_markdown, todo.source_text]);

  const saveTodo = useRef(
    debounce((nextText: string) => {
      const trimmed = nextText.trim();
      if (trimmed === lastSavedTextRef.current) return;
      lastSavedTextRef.current = trimmed;
      onUpdate(todo.id, trimmed, null);
    }, 700),
  ).current;

  useEffect(() => {
    return () => {
      saveTodo.cancel();
    };
  }, [saveTodo]);

  const handleChange = (nextText: string) => {
    setText(nextText);
    saveTodo(nextText);
  };

  return (
    <div
      className={`flex items-start gap-3 py-1.5 group rounded-lg transition-colors ${
        todo.is_checked ? "opacity-50" : ""
      }`}
      style={{
        background: "transparent",
      }}
    >
      <input
        type="checkbox"
        checked={todo.is_checked}
        onChange={() => onToggle(todo.id, !todo.is_checked)}
        className="mt-1 accent-emerald-500 cursor-pointer shrink-0"
      />
      <div className="flex-1 min-w-0">
        <input
          type="text"
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={() => saveTodo.flush()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          className={`w-full bg-transparent border-0 px-0 py-0.5 text-base outline-none placeholder:text-zinc-500 focus:outline-none focus:ring-0 ${
            todo.is_checked ? "line-through text-zinc-500" : "text-zinc-100"
          }`}
          placeholder="Untitled to-do"
          aria-label="To-do text"
        />
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
  onAdd: (markdown: string, json: string | null) => void;
}) {
  const [text, setText] = useState("");

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAdd(trimmed, null);
    setText("");
  }

  return (
    <div className="flex items-center gap-3 py-1.5 group">
      <div className="w-4 h-4 rounded border border-zinc-600 shrink-0 mt-0.5" />
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleSubmit();
          }
        }}
        className="flex-1 min-w-0 bg-transparent border-0 px-0 py-0.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:outline-none focus:ring-0"
        placeholder="Add a to-do"
        aria-label="Add a to-do"
      />
      <button
        onClick={handleSubmit}
        className="text-xs text-emerald-500 hover:text-emerald-400 transition-colors"
      >
        Add
      </button>
    </div>
  );
}
