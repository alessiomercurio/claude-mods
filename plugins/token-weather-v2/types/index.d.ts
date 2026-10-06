export type Eater = {
  /** The category as /context labels it: System prompt, System tools, Messages, ... */
  name: string
  tokens: number
}

export type Forecast = {
  /** Context tokens used after each recent main-loop turn, oldest first (at most 12). */
  history: number[]
  /** The model's context window, in tokens. */
  window: number
  /** What fills the window after the last turn, largest first. */
  eaters: Eater[]
}

declare module 'claude-code' {
  interface PluginState {
    'token-weather-v2': { forecast: Forecast | null }
  }
}
