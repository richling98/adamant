"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, ListTodo, Plus, Trash2 } from "lucide-react";
import debounce from "lodash/debounce";
import { toast } from "sonner";
import type { Todo } from "@/types";
import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import { addDaysToDateKey, localDateKey } from "@/lib/dateKey";
import {
  getAllTodos,
  getTodosByDate,
  toggleTodo as apiToggleTodo,
  deleteTodo as apiDeleteTodo,
  createTodo as apiCreateTodo,
  reorderTodosByDate as apiReorderTodosByDate,
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

function sortTodosForDisplay(items: Todo[]): Todo[] {
  return [...items].sort((a, b) => {
    const dateCompare = b.date.localeCompare(a.date);
    if (dateCompare !== 0) return dateCompare;
    const orderCompare = a.sort_order - b.sort_order;
    if (orderCompare !== 0) return orderCompare;
    return a.created_at.localeCompare(b.created_at);
  });
}

export function TodosPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { fetchTodoDates, todoRefreshVersion } = useSidebar();
  const dateParam = searchParams.get("date");
  const viewParam = searchParams.get("view");
  const todayStr = localDateKey();
  const isAllView = viewParam === "all" || !dateParam;
  const activeDate = dateParam || todayStr;

  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusedTodoId, setFocusedTodoId] = useState<string | null>(null);
  const [showActionsHelp, setShowActionsHelp] = useState(false);
  const [showAllComposer, setShowAllComposer] = useState(false);
  const [expandRequest, setExpandRequest] = useState<{ date: string; version: number } | null>(null);

  const fetchTodos = useCallback(async () => {
    setLoading(true);
    try {
      const data = isAllView ? await getAllTodos() : await getTodosByDate(activeDate);
      setTodos(sortTodosForDisplay(data));
    } catch (e) {
      toast.error("Failed to load to-dos");
    } finally {
      setLoading(false);
    }
  }, [activeDate, isAllView]);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos, todoRefreshVersion]);

  const groupedTodos = useMemo(() => {
    if (!isAllView) return [];

    const groups = new Map<string, Todo[]>();
    for (const todo of todos) {
      if (!groups.has(todo.date)) {
        groups.set(todo.date, []);
      }
      groups.get(todo.date)!.push(todo);
    }

    return Array.from(groups.entries()).map(([date, items]) => ({
      date,
      items,
    }));
  }, [todos, isAllView]);

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

  const handleAddForDate = useCallback(async (date: string, markdown: string, json: string | null) => {
    try {
      const newTodo = await apiCreateTodo(null, date, json, markdown);
      setTodos((prev) => sortTodosForDisplay([...prev, { ...newTodo, meeting_title: newTodo.meeting_title ?? "" }]));
      setFocusedTodoId(newTodo.id);
      setExpandRequest({ date, version: Date.now() });
      fetchTodoDates();
      return true;
    } catch (e) {
      toast.error("Failed to create action");
      return false;
    }
  }, [fetchTodoDates]);

  const handleCreateBelow = useCallback(
    async (todo: Todo) => {
      try {
        const newTodo = await apiCreateTodo(null, todo.date, null, null);
        const normalizedTodo = { ...newTodo, meeting_title: newTodo.meeting_title ?? "" };

        setTodos((prev) => {
          const next = [...prev];
          const currentIndex = next.findIndex((item) => item.id === todo.id);
          if (currentIndex === -1) {
            return sortTodosForDisplay([...prev, normalizedTodo]);
          }

          next.splice(currentIndex + 1, 0, normalizedTodo);
          return next;
        });

        const reorderedIds = todos
          .filter((item) => item.date === todo.date)
          .map((item) => item.id);
        const currentIndex = reorderedIds.indexOf(todo.id);
        if (currentIndex !== -1) {
          reorderedIds.splice(currentIndex + 1, 0, normalizedTodo.id);
          await apiReorderTodosByDate(todo.date, reorderedIds);
        }

        setFocusedTodoId(normalizedTodo.id);
        fetchTodoDates();
      } catch (e) {
        toast.error("Failed to create to-do");
      }
    },
    [fetchTodoDates, todos],
  );

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
  const totalCount = todos.length;

  return (
    <div className="min-h-screen bg-background p-6 max-w-3xl mx-auto">
      {/* Header */}
      {/* Header: true-centered title using absolute, both left/right sides symmetric */}
      <div className="relative flex items-center h-10 mb-6">
        <button
          onClick={() => router.back()}
          className="relative z-10 text-zinc-400 hover:text-zinc-200 transition-colors flex items-center justify-center flex-shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {isAllView ? (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2">
              <ListTodo className="w-4 h-4 text-primary" />
              <h1 className="text-lg font-semibold text-zinc-100 leading-none">All Actions</h1>
              <button
                type="button"
                onClick={() => setShowAllComposer(true)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary transition-colors hover:border-primary/45 hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-primary/35"
                aria-label="Add action"
              >
                <Plus className="h-4 w-4" />
              </button>
              <div
                className="relative flex items-center"
              onMouseEnter={() => setShowActionsHelp(true)}
              onMouseLeave={() => setShowActionsHelp(false)}
            >
              <button
                type="button"
                className="inline-flex items-center text-zinc-500 transition-colors hover:text-zinc-300"
                aria-label="About actions"
                aria-expanded={showActionsHelp}
                onClick={() => setShowActionsHelp((prev) => !prev)}
              >
                <CircleHelp className="w-4 h-4" />
              </button>
              {showActionsHelp && (
                <div className="absolute left-1/2 top-full z-50 mt-2 w-72 -translate-x-1/2 rounded-md border border-white/10 bg-primary px-3 py-2 text-sm leading-relaxed text-primary-foreground shadow-xl">
                  We automatically capture actions and to-do&apos;s from your meetings using AI. You can modify or add actions as you please.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-3">
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
        )}

        <div className="ml-auto w-5 flex-shrink-0" aria-hidden />
      </div>

      {isAllView ? (
        <>
          {todos.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center">
              <p className="text-sm text-zinc-500 leading-relaxed max-w-md">
                Adamant will automatically capture actions and to-do&apos;s from your meeting notes. You can also add standalone actions manually.
              </p>
              <div className="mt-6 w-full max-w-md">
                <ActionComposer
                  onAdd={(markdown, json) => handleAddForDate(todayStr, markdown, json)}
                  label="Add your first action"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-zinc-500 uppercase tracking-wider flex items-center justify-between">
                <span>{totalCount} total</span>
                <span>{checked.length} completed</span>
              </div>
              {showAllComposer && (
                <InlineActionComposer
                  onAdd={(markdown, json) => handleAddForDate(todayStr, markdown, json)}
                  onCancel={() => setShowAllComposer(false)}
                />
              )}
              {groupedTodos.map((group, index) => (
                <TodosDateGroup
                  key={group.date}
                  date={group.date}
                  todos={group.items}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onUpdate={handleUpdate}
                  onCreateBelow={handleCreateBelow}
                  onAddForDate={handleAddForDate}
                  focusedTodoId={focusedTodoId}
                  defaultExpanded={index === 0}
                  expandSignal={expandRequest?.date === group.date ? expandRequest.version : 0}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Empty state */}
          {todos.length === 0 && (
            <div className="text-center py-16 text-zinc-500">
              <p className="text-sm">No actions for {formatDateLabel(activeDate)}</p>
              <p className="text-xs mt-1">
                Run AI cleanup on a meeting to extract action items, or use the plus button to add one manually.
              </p>
            </div>
          )}

          <ActionComposer onAdd={(markdown, json) => handleAddForDate(activeDate, markdown, json)} />

          {/* Unchecked todos */}
          <div className="space-y-1">
            {unchecked.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onUpdate={handleUpdate}
                autoFocus={focusedTodoId === todo.id}
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
                    autoFocus={focusedTodoId === todo.id}
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
        </>
      )}
    </div>
  );
}

function TodoRow({
  todo,
  onToggle,
  onDelete,
  onUpdate,
  onCreateBelow,
  autoFocus = false,
}: {
  todo: Todo;
  onToggle: (id: string, checked: boolean) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, markdown: string, json: string | null) => void;
  onCreateBelow?: (todo: Todo) => void | Promise<void>;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
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

  useEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [autoFocus]);

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
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={todo.is_checked}
            onChange={() => onToggle(todo.id, !todo.is_checked)}
            className="accent-primary cursor-pointer shrink-0"
          />
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={() => saveTodo.flush()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const target = e.currentTarget;
                const atEnd =
                  typeof target.selectionStart === "number" &&
                  typeof target.selectionEnd === "number" &&
                  target.selectionStart === target.value.length &&
                  target.selectionEnd === target.value.length;

                if (atEnd && onCreateBelow) {
                  e.preventDefault();
                  saveTodo.flush();
                  void onCreateBelow(todo);
                  return;
                }

                e.preventDefault();
                target.blur();
              }
            }}
            className={`flex-1 min-w-0 bg-transparent border-0 px-0 py-0.5 text-base outline-none placeholder:text-zinc-500 focus:outline-none focus:ring-0 ${
              todo.is_checked ? "line-through text-zinc-500" : "text-zinc-100"
            }`}
            placeholder="Untitled to-do"
            aria-label="To-do text"
          />
        </div>
        {todo.meeting_id && todo.meeting_title && (
          <button
            onClick={() =>
              router.push(`/meeting-details?id=${todo.meeting_id}`)
            }
            className="text-xs text-zinc-500 hover:text-primary/80 transition-colors mt-0.5"
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

function ActionComposer({
  onAdd,
  label = "Add action",
}: {
  onAdd: (markdown: string, json: string | null) => Promise<boolean>;
  label?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (isOpen) {
    return (
      <InlineActionComposer
        onAdd={onAdd}
        onCancel={() => setIsOpen(false)}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setIsOpen(true)}
      className="group flex w-full items-center gap-3 rounded-lg py-1.5 text-left text-sm text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-primary/25"
      aria-label={label}
    >
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-primary/35 bg-primary/10 text-primary transition-colors group-hover:border-primary/55 group-hover:bg-primary/15">
        <Plus className="h-3 w-3" />
      </span>
      <span>{label}</span>
    </button>
  );
}

function InlineActionComposer({
  onAdd,
  onCancel,
}: {
  onAdd: (markdown: string, json: string | null) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const created = await onAdd(trimmed, null);
    if (created) {
      setText("");
      onCancel();
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg py-1.5 group">
      <div className="w-4 h-4 rounded border border-primary/45 bg-primary/10 shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void handleSubmit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className="flex-1 min-w-0 bg-transparent border-0 px-0 py-0.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:outline-none focus:ring-0"
        placeholder="Add an action"
        aria-label="New action text"
      />
      <button
        type="button"
        onClick={() => void handleSubmit()}
        className="text-xs text-primary hover:text-primary/80 transition-colors"
      >
        Add
      </button>
    </div>
  );
}

function TodosDateGroup({
  date,
  todos,
  onToggle,
  onDelete,
  onUpdate,
  onCreateBelow,
  onAddForDate,
  focusedTodoId,
  defaultExpanded = false,
  expandSignal = 0,
}: {
  date: string;
  todos: Todo[];
  onToggle: (id: string, checked: boolean) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, markdown: string, json: string | null) => void;
  onCreateBelow: (todo: Todo) => void | Promise<void>;
  onAddForDate: (date: string, markdown: string, json: string | null) => Promise<boolean>;
  focusedTodoId: string | null;
  defaultExpanded?: boolean;
  expandSignal?: number;
}) {
  const label = formatDateLabel(date);
  const [isExpanded, setIsExpanded] = useState(() => {
    try {
      const stored = localStorage.getItem(`todos-all-date-${date}`);
      if (stored !== null) return stored === 'true';
    } catch {}
    return defaultExpanded;
  });
  const [showComposer, setShowComposer] = useState(false);

  useEffect(() => {
    if (!expandSignal) return;
    setIsExpanded(true);
  }, [expandSignal]);

  const unchecked = todos.filter((t) => !t.is_checked);
  const checked = todos.filter((t) => t.is_checked);
  const total = todos.length;

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03]">
      <div className="flex items-center transition-colors hover:bg-white/[0.04]">
        <button
          onClick={() => {
            setIsExpanded((prev) => {
              const next = !prev;
              try { localStorage.setItem(`todos-all-date-${date}`, String(next)); } catch {}
              return next;
            });
          }}
          className="flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left"
        >
          <span className="text-zinc-500 flex-shrink-0">
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
          <span className="flex-1 min-w-0 text-sm font-medium text-zinc-100 truncate">{label}</span>
          <span className="text-xs text-zinc-500 flex-shrink-0">
            {total} item{total !== 1 ? 's' : ''}
          </span>
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setIsExpanded(true);
            setShowComposer(true);
          }}
          className="mr-3 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary transition-colors hover:border-primary/45 hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-primary/35"
          aria-label={`Add action for ${label}`}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className={`overflow-hidden transition-all duration-200 ${isExpanded ? 'max-h-[9999px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="px-4 pb-4 pt-1">
          {showComposer && (
            <div className="mb-2">
              <InlineActionComposer
                onAdd={(markdown, json) => onAddForDate(date, markdown, json)}
                onCancel={() => setShowComposer(false)}
              />
            </div>
          )}

          {unchecked.length > 0 && (
            <div className="space-y-1">
              {unchecked.map((todo) => (
                <TodoRow
                  key={todo.id}
                  todo={todo}
                  onToggle={onToggle}
                  onDelete={onDelete}
                  onUpdate={onUpdate}
                  onCreateBelow={onCreateBelow}
                  autoFocus={focusedTodoId === todo.id}
                />
              ))}
            </div>
          )}

          {checked.length > 0 && (
            <div className={unchecked.length > 0 ? 'mt-3' : ''}>
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
                    onToggle={onToggle}
                    onDelete={onDelete}
                    onUpdate={onUpdate}
                    onCreateBelow={onCreateBelow}
                    autoFocus={focusedTodoId === todo.id}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
