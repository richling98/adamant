import { invoke } from '@tauri-apps/api/core';
import type { Todo, TodoDateSummary } from '@/types';

export async function getTodosByDate(date: string): Promise<Todo[]> {
  return invoke('api_get_todos_by_date', { date });
}

export async function getAllTodos(): Promise<Todo[]> {
  return invoke('api_get_all_todos');
}

export async function getTodoDates(): Promise<TodoDateSummary[]> {
  return invoke('api_get_todo_dates');
}

export async function getTodayTodos(): Promise<Todo[]> {
  return invoke('api_get_today_todos');
}

export async function getMeetingTodos(meetingId: string): Promise<Todo[]> {
  return invoke('api_get_meeting_todos', { meetingId });
}

export async function createTodo(
  meetingId: string | null,
  date: string,
  contentJson: string | null,
  contentMarkdown: string | null,
): Promise<Todo> {
  return invoke('api_create_todo', { meetingId, date, contentJson, contentMarkdown });
}

export async function updateTodo(
  todoId: string,
  contentJson: string | null,
  contentMarkdown: string | null,
): Promise<void> {
  return invoke('api_update_todo', { todoId, contentJson, contentMarkdown });
}

export async function toggleTodo(
  todoId: string,
  isChecked: boolean,
): Promise<void> {
  return invoke('api_toggle_todo', { todoId, isChecked });
}

export async function deleteTodo(todoId: string): Promise<void> {
  return invoke('api_delete_todo', { todoId });
}
