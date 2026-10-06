import type { Agent, Phase, PlanStep, Summary } from '../types'

export const clip = (s: string, n = 60): string => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

/** A new turn; a plan with steps still open carries over, a finished one is dropped, and so do finished agents. */
export const begin = (prev: Summary | null, window = WINDOW): Summary => {
  const plan = prev?.plan ?? []
  return {
    isActive: true,
    phase: 'thinking',
    calls: 0,
    agents: (prev?.agents ?? []).filter(a => a.status === 'running'),
    window,
    plan: plan.some(s => s.status !== 'completed') ? plan : [],
    elapsedMs: 0,
  }
}

const empty = (): Summary => begin(null)

export const setPhase = (r: Summary | null, phase: Phase, tool?: string): Summary => ({
  ...(r ?? empty()),
  phase,
  tool,
})

export const counted = (r: Summary | null): Summary => {
  const next = r ?? empty()
  return { ...next, calls: next.calls + 1 }
}

// Used when the session's window cannot be read.
const WINDOW = 200_000

export const hasAgent = (r: Summary | null, id: string): boolean => !!r?.agents.some(a => a.id === id)

export const addAgent = (r: Summary | null, id: string, label: string, type: string): Summary => {
  const next = r ?? empty()
  if (hasAgent(next, id)) return next
  const agent: Agent = { id, label: clip(label, 40) || 'agent', type, phase: 'thinking', tokens: 0, status: 'running' }
  return { ...next, agents: [...next.agents, agent] }
}

const withAgent = (r: Summary | null, id: string, change: (a: Agent) => Agent): Summary => {
  const next = r ?? empty()
  return { ...next, agents: next.agents.map(a => (a.id === id ? change(a) : a)) }
}

export const agentPhase = (r: Summary | null, id: string, phase: Phase, tool?: string): Summary =>
  withAgent(r, id, a => ({ ...a, phase, tool }))

export const agentTokens = (r: Summary | null, id: string, tokens: number): Summary =>
  withAgent(r, id, a => ({ ...a, tokens }))

export const agentDone = (r: Summary | null, id: string, isFailed: boolean): Summary =>
  withAgent(r, id, a => ({ ...a, phase: isFailed ? 'failed' : 'done', tool: undefined, status: isFailed ? 'failed' : 'done' }))

/** The context a model call was answered over: uncached, cache-written and cache-read input together. */
export const contextOf = (u: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }) =>
  u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

export const percentOf = (tokens: number, window: number): number =>
  window > 0 ? Math.min(100, Math.round((tokens / window) * 100)) : 0

/** An agent's context as a short meter; its last cell warns as the window fills. */
export const meter = (percent: number, width = 8): string => {
  const n = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width)
  return '▰'.repeat(n) + '▱'.repeat(width - n)
}

export const pressure = (percent: number): string => (percent >= 90 ? '⚠' : percent >= 70 ? '▲' : ' ')

export const peak = (r: Summary): number => Math.max(0, ...r.agents.map(a => percentOf(a.tokens, r.window)))

/** What an agent is doing, in a word or two. */
export const agentDoing = (a: Agent): string =>
  a.status === 'failed' ? 'stopped' : a.status === 'done' ? 'done' : a.phase === 'working' ? `running ${a.tool ?? 'a tool'}` : a.phase

/** Running agents first, then the ones that finished; at most `max`. */
export const shownAgents = (agents: readonly Agent[], max: number) => {
  const order = [...agents.filter(a => a.status === 'running'), ...agents.filter(a => a.status !== 'running')]
  return { agents: order.slice(0, max), hidden: Math.max(0, order.length - max) }
}

export const running = (r: Summary): number => r.agents.filter(a => a.status === 'running').length

/** The band stays live while the main loop runs or any agent does: a background agent outlives its turn. */
export const isLive = (r: Summary): boolean => r.isActive || running(r) > 0

/** Closes the agents the session lists as no longer running; one it does not list is left as it is. */
export const reconcile = (r: Summary | null, list: readonly { id: string; status: string }[]): Summary => {
  const next = r ?? empty()
  const status = new Map(list.map(a => [a.id, a.status]))
  return {
    ...next,
    agents: next.agents.map(a => {
      const s = status.get(a.id)
      if (a.status !== 'running' || s === undefined || s === 'running') return a
      const isFailed = s === 'failed' || s === 'killed'
      return { ...a, phase: isFailed ? 'failed' : 'done', tool: undefined, status: isFailed ? 'failed' : 'done' }
    }),
  }
}

export const finish = (r: Summary | null, isFailed: boolean, durationMs?: number): Summary => {
  const next = r ?? empty()
  return {
    ...next,
    isActive: false,
    phase: isFailed ? 'failed' : 'done',
    tool: undefined,
    elapsedMs: durationMs ?? next.elapsedMs,
  }
}

type Todo = { content: string; status: PlanStep['status']; activeForm?: string }

/** TodoWrite sends the whole list each time. */
export const fromTodos = (r: Summary | null, todos: readonly Todo[]): Summary => ({
  ...(r ?? empty()),
  plan: todos.map((t, i) => ({ id: `todo-${i}`, subject: t.content, activeForm: t.activeForm, status: t.status })),
})

const STATUSES: readonly string[] = ['pending', 'in_progress', 'completed']

/** The plan tool's input, checked: its steps, or why they are refused. */
export const parsePlan = (input: { todos?: unknown }): { todos: Todo[] } | { error: string } => {
  const todos = input.todos
  if (!Array.isArray(todos)) return { error: '`todos` must be a list of steps.' }
  for (const [i, t] of todos.entries()) {
    const step = t as Partial<Todo> | null
    if (!step || typeof step.content !== 'string' || !step.content.trim())
      return { error: `Step ${i + 1} needs a \`content\`.` }
    if (!STATUSES.includes(step.status as string))
      return { error: `Step ${i + 1} has status ${JSON.stringify(step.status)}; use pending, in_progress or completed.` }
  }
  return { todos: todos as Todo[] }
}

/** What the model reads back after updating its plan. */
export const planAnswer = (plan: readonly PlanStep[]): string => {
  const p = progress(plan)
  return p.total ? `Plan updated: ${p.done} of ${p.total} steps completed.` : 'Plan cleared.'
}

/** TaskCreate adds one step, pending. */
export const taskCreated = (r: Summary | null, id: string, subject: string, activeForm?: string): Summary => {
  const next = r ?? empty()
  return { ...next, plan: [...next.plan, { id, subject, activeForm, status: 'pending' }] }
}

/** TaskUpdate changes one step; status "deleted" removes it. */
export const taskUpdated = (
  r: Summary | null,
  u: { taskId: string; subject?: string; activeForm?: string; status?: PlanStep['status'] | 'deleted' },
): Summary => {
  const next = r ?? empty()
  const status = u.status
  if (status === 'deleted') return { ...next, plan: next.plan.filter(s => s.id !== u.taskId) }
  return {
    ...next,
    plan: next.plan.map(s =>
      s.id === u.taskId
        ? {
            ...s,
            subject: u.subject ?? s.subject,
            activeForm: u.activeForm ?? s.activeForm,
            status: status ?? s.status,
          }
        : s,
    ),
  }
}

/** Where the plan stands: the step being worked on (0-based) and the share done. */
export const progress = (plan: readonly PlanStep[]) => {
  const done = plan.filter(s => s.status === 'completed').length
  const open = plan.findIndex(s => s.status === 'in_progress')
  const pending = plan.findIndex(s => s.status === 'pending')
  const current = open >= 0 ? open : pending >= 0 ? pending : plan.length - 1
  return { done, total: plan.length, current, percent: plan.length ? Math.round((done / plan.length) * 100) : 0 }
}

/** The band's title while a plan runs: the step being worked on, as the model phrased it. */
export const stepTitle = (plan: readonly PlanStep[], current: number): string => {
  const s = plan[current]
  if (!s) return 'Plan'
  return clip(s.status === 'in_progress' ? s.activeForm || s.subject : s.subject)
}

/** At most `max` steps, starting one before the current step so what just finished stays in view. */
export const visible = (plan: readonly PlanStep[], current: number, max: number) => {
  const size = Math.max(1, Math.min(max, plan.length))
  const from = Math.max(0, Math.min(current - 1, plan.length - size))
  return { steps: plan.slice(from, from + size), before: from, after: plan.length - from - size }
}

export const bar = (fraction: number, width = 20): string => {
  const n = Math.round(Math.max(0, Math.min(1, fraction)) * width)
  return '█'.repeat(n) + '░'.repeat(width - n)
}

export const ICON: Record<Phase, string> = {
  thinking: '✻',
  writing: '✎',
  working: '⚙',
  done: '✓',
  failed: '✗',
}

export const STEP_ICON: Record<PlanStep['status'], string> = { completed: '✓', in_progress: '●', pending: '○' }

/** What is happening now, in a few words. */
export const activity = (r: Summary): string => {
  const n = running(r)
  if (n) return `${plural(n, 'agent')} working`
  switch (r.phase) {
    case 'working':
      return `running ${r.tool ?? 'a tool'}`
    case 'failed':
      return 'stopped'
    default:
      return r.phase
  }
}

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export const seconds = (ms: number): string =>
  ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
