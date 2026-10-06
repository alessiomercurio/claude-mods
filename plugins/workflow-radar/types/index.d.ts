/** What the main loop is doing right now. */
export type Phase = 'thinking' | 'writing' | 'working' | 'done' | 'failed'

/** One step of the model's plan: an item of its todo list or task list. */
export type PlanStep = {
  id: string
  subject: string
  /** The present-continuous form shown while the step is in progress ("Running tests"). */
  activeForm?: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** A subagent the turn spawned. */
export type Agent = {
  id: string
  /** The agent's description ("Find auth code"). */
  label: string
  /** The agent type (Explore, general-purpose, ...). */
  type: string
  phase: Phase
  /** The tool the agent is running, while `phase` is working. */
  tool?: string
  /** Input tokens its last model call was answered over: the context it holds. */
  tokens: number
  status: 'running' | 'done' | 'failed'
}

export type Summary = {
  isActive: boolean
  phase: Phase
  /** The tool the main loop is running, while `phase` is working. */
  tool?: string
  /** Tool calls made in the turn, by every loop. */
  calls: number
  /** Subagents seen in the turn, in the order they started. */
  agents: Agent[]
  /** The session's context window in tokens, which the agents' meters are measured against. */
  window: number
  /** The model's plan; kept across turns until every step is done. */
  plan: PlanStep[]
  /** Time since the turn started, or how long it took once it finished. */
  elapsedMs: number
}

declare module 'claude-code' {
  interface PluginState {
    'workflow-radar': { summary: Summary | null }
  }
}
