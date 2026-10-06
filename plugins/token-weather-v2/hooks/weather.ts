export const HISTORY = 12
const BARS = '▁▂▃▄▅▆▇█'

export type Sky = { icon: string; word: string }

export const sky = (percent: number): Sky => {
  if (percent < 25) return { icon: '☀', word: 'Clear' }
  if (percent < 50) return { icon: '☁', word: 'Cloudy' }
  if (percent < 75) return { icon: '☂', word: 'Showers' }
  if (percent < 90) return { icon: '☇', word: 'Storm' }
  return { icon: '↯', word: 'Compact soon' }
}

/** 134400 → "134.4k", 200000 → "200k", 1000000 → "1M", 950 → "950". */
export const tokens = (n: number): string => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`
  if (abs >= 1_000) return `${trim(n / 1_000)}k`
  return `${Math.round(n)}`
}

const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '')

/** Bars scaled against the window, so the chart reads as fullness, not just shape. */
export const sparkline = (history: number[], window: number): string =>
  history
    .map(t => {
      const i = Math.round((Math.min(t, window) / window) * (BARS.length - 1))
      return BARS[Math.max(0, Math.min(BARS.length - 1, i))]
    })
    .join('')

export const delta = (history: number[]): string | null => {
  if (history.length < 2) return null
  const d = history[history.length - 1]! - history[history.length - 2]!
  if (d > 0) return `▲ +${tokens(d)} last turn`
  if (d < 0) return `▼ −${tokens(-d)} last turn`
  return '▬ ±0 last turn'
}

export const push = (history: number[], t: number): number[] =>
  [...history, t].slice(-HISTORY)

/** The biggest eaters of the window, largest first, empty ones left out. */
export const top = <E extends { name: string; tokens: number }>(eaters: E[], max = 5): E[] =>
  eaters
    .filter(e => e.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, max)
