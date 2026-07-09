'use client'

import { useState } from 'react'
import { useConfig } from '@/contexts/ConfigContext'
import { cn } from '@/lib/utils'
import { THEME_OPTIONS } from '@/lib/theme'

const THEME_SWATCHES: Record<(typeof THEME_OPTIONS)[number]['value'], { accent: string; glow: string; surface: string }> = {
  rune: {
    accent: 'hsl(214 92% 66%)',
    glow: 'rgba(96, 165, 250, 0.22)',
    surface: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.98))',
  },
  mithril: {
    accent: 'hsl(248 28% 46%)',
    glow: 'rgba(97, 86, 152, 0.24)',
    surface: 'linear-gradient(135deg, rgba(18, 18, 31, 0.97), rgba(41, 38, 61, 0.99))',
  },
  bronze: {
    accent: 'hsl(32 56% 58%)',
    glow: 'rgba(180, 120, 54, 0.24)',
    surface: 'linear-gradient(135deg, rgba(28, 19, 10, 0.96), rgba(58, 37, 20, 0.98))',
  },
  adamant: {
    accent: 'hsl(151 46% 36%)',
    glow: 'rgba(32, 126, 91, 0.26)',
    surface: 'linear-gradient(135deg, rgba(10, 24, 18, 0.97), rgba(17, 45, 34, 0.99))',
  },
}

export function ThemeSettings() {
  const { uiTheme, setUiTheme } = useConfig()
  const [hoveredTheme, setHoveredTheme] = useState<typeof uiTheme | null>(null)

  return (
    <div className="space-y-4">
      <div className="bg-white/5 rounded-lg border border-white/10 p-6">
        <div className="flex flex-col gap-4 mb-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-white mb-2">Color Theme</h3>
            <p className="text-sm text-zinc-400">
              Choose a dark theme for Adamant. Each option keeps the interface low-light and shifts the accent tone.
            </p>
          </div>
          <div className="hidden lg:block" />
        </div>

        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
          {THEME_OPTIONS.map((option) => {
            const swatch = THEME_SWATCHES[option.value]
            const selected = uiTheme === option.value
            const isHovered = hoveredTheme === option.value

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setUiTheme(option.value)}
                onMouseEnter={() => setHoveredTheme(option.value)}
                onMouseLeave={() => setHoveredTheme(null)}
                className={cn(
                  'group relative overflow-hidden rounded-2xl border p-5 text-left transition-all duration-200 border-white/10 hover:border-white/20 min-h-[186px]',
                  selected && 'border-white/20'
                )}
                style={{
                  background: swatch.surface,
                  borderColor: selected ? 'hsl(var(--primary))' : undefined,
                  boxShadow: selected ? `0 0 0 1px ${swatch.glow}, 0 10px 30px rgba(0, 0, 0, 0.28)` : undefined,
                }}
              >
                <div
                  className="pointer-events-none absolute inset-0 transition-opacity duration-200"
                  style={{
                    backgroundColor: swatch.accent,
                    opacity: isHovered || selected ? 0.16 : 0,
                  }}
                />
                <div className="relative z-10 flex h-full flex-col gap-4">
                  <div
                    className="h-11 w-11 rounded-xl border border-white/10 shadow-inner"
                    style={{
                      background: `linear-gradient(135deg, ${swatch.accent}, rgba(255,255,255,0.06))`,
                      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.12), 0 0 24px ${swatch.glow}`,
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-base font-semibold text-white">{option.label}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">{option.description}</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
