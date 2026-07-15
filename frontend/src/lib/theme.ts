export const THEME_STORAGE_KEY = 'adamant-ui-theme'

export type ThemeName = 'rune' | 'mithril' | 'bronze' | 'adamant'

export interface ThemeOption {
  value: ThemeName
  label: string
  description: string
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    value: 'rune',
    label: 'Rune',
    description: 'A slate-dark theme with a subtle blue accent.',
  },
  {
    value: 'mithril',
    label: 'Mithril',
    description: 'A deep indigo-purple with calm undertones.',
  },
  {
    value: 'bronze',
    label: 'Bronze',
    description: 'An elegant brown-earth palette with warm highlights.',
  },
  {
    value: 'adamant',
    label: 'Adamant',
    description: 'A lush dark green palette with a restrained metallic glow.',
  },
]

export const DEFAULT_THEME: ThemeName = 'adamant'

export function isThemeName(value: string | null | undefined): value is ThemeName {
  return value === 'rune' || value === 'mithril' || value === 'bronze' || value === 'adamant'
}
