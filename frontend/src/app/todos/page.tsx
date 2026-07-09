"use client"

import { Suspense } from "react";
import { TodosPage } from "@/components/Todos/TodosPage";

export default function TodosRoute() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background p-6 max-w-3xl mx-auto animate-pulse">
        <div className="h-8 w-48 bg-zinc-800 rounded mb-6" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-3 py-2">
            <div className="w-4 h-4 bg-zinc-800 rounded mt-0.5" />
            <div className="flex-1 h-6 bg-zinc-800 rounded" />
          </div>
        ))}
      </div>
    }>
      <TodosPage />
    </Suspense>
  );
}
