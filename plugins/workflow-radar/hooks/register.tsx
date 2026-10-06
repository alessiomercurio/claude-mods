import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Agent, Phase, PlanStep } from '../types'
import {
  ICON,
  STEP_ICON,
  activity,
  addAgent,
  agentDoing,
  agentDone,
  agentPhase,
  agentTokens,
  bar,
  begin,
  contextOf,
  counted,
  finish,
  fromTodos,
  hasAgent,
  isLive,
  meter,
  peak,
  percentOf,
  parsePlan,
  planAnswer,
  plural,
  pressure,
  reconcile,
  progress,
  seconds,
  setPhase,
  shownAgents,
  stepTitle,
  taskCreated,
  taskUpdated,
  visible,
} from './radar'

const summary = atom({ plugin: 'workflow-radar', key: 'summary' } as const, null)

// Most plan steps and agents the band lists; the rest are counted on one row each.
const STEPS = 6
const AGENTS = 4

// The plan tool this mod gives the model, in place of TodoWrite where the session has none.
const PLAN_TOOL = 'plan'
const PLAN = 'mcp__workflow-radar__plan'
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    todos: {
      type: 'array',
      description: 'The whole plan, every step, in order. Each call replaces the previous plan.',
      items: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The step, imperative ("Run the tests").' },
          activeForm: { type: 'string', description: 'The step while it runs, present continuous ("Running the tests").' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
        },
        required: ['content', 'status'],
      },
    },
  },
  required: ['todos'],
}
const PLAN_DESCRIPTION =
  "Write or update your plan for the current task: the person sees it live as a checklist above the prompt. Send the whole list every time; it replaces the previous one."
const PLAN_GUIDANCE = `# Plan
For a task with three or more distinct steps, call ${PLAN} before starting, with every step pending except the first, in_progress. Update it as you go: mark a step completed as soon as it is done and the next one in_progress, keeping exactly one step in_progress while work remains. Add or drop steps when the work changes. Skip it for simple tasks and plain questions.`

// Each loop's last phase ('main' for the main loop), so a stream writes state once.
const MAIN = 'main'
const shown = new Map<string, Phase>()

// Ticks the elapsed time once a second while a turn or a background agent runs.
let tick: Timer | undefined
let startedAt = 0

function startTick($: EngineInterface) {
  tick?.cancel()
  tick = $.clock.every(1000, () => {
    void (async () => {
      const now = await $.clock.now()
      let r = await read($, summary)
      // Once the turn is over no event of ours marks an agent that was stopped; the session's list does.
      if (r && !r.isActive) {
        const list = await $.agent.list()
        await update($, summary, s => reconcile(s, list))
        r = await read($, summary)
      }
      if (!r || !isLive(r)) return stopTick()
      await update($, summary, s => (s && isLive(s) ? { ...s, elapsedMs: now - startedAt } : s))
    })()
  })
}

function stopTick() {
  tick?.cancel()
  tick = undefined
}

async function phase($: EngineInterface, loop: string, p: Phase, tool?: string) {
  if (shown.get(loop) === p && p !== 'working') return
  shown.set(loop, p)
  await update($, summary, r => (loop === MAIN ? setPhase(r, p, tool) : agentPhase(r, loop, p, tool)))
}

/** Adds a subagent the first time one of its events arrives, named as the session lists it. */
async function seen($: EngineInterface, id: string) {
  if (hasAgent(await read($, summary), id)) return
  const agent = (await $.agent.list()).find(a => a.id === id)
  await update($, summary, r => addAgent(r, id, agent?.description ?? 'agent', agent?.type ?? ''))
}

async function sessionWindow($: EngineInterface): Promise<number | undefined> {
  try {
    return (await $.session.usage()).context.window
  } catch {
    return undefined
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: PLAN_TOOL, description: PLAN_DESCRIPTION, inputSchema: PLAN_SCHEMA })
    return next(e)
  })

  // Taught only to a request that offers the tool.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.tools.includes(PLAN)) return composed
    return { sections: [...composed.sections, { id: 'workflow-radar:plan', text: PLAN_GUIDANCE, scope: 'session' as const }] }
  })

  on('turn.start', async ($, e, next) => {
    shown.clear()
    shown.set(MAIN, 'thinking')
    startedAt = await $.clock.now()
    const window = await sessionWindow($)
    await update($, summary, r => begin(r, window))
    startTick($)
    return next(e)
  })

  // Listed as soon as it starts, under the description it was given; a background one has no other event for a while.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const id = result.agentId
    if (id) await update($, summary, r => addAgent(r, id, e.description || 'agent', e.subagentType))
    return result
  })

  on('turn.step', async function* ($, e, next) {
    const loop = e.agentId ?? MAIN
    if (loop !== MAIN) await seen($, loop)
    await phase($, loop, 'thinking')
    const stream = next(e)
    for (;;) {
      const step = await stream.next()
      if (step.done) {
        // The usage of a subagent's call is the context it now holds.
        const usage = step.value.usage
        if (loop !== MAIN && usage) await update($, summary, r => agentTokens(r, loop, contextOf(usage)))
        return step.value
      }
      const chunk = step.value
      if (chunk.kind === 'thinking') await phase($, loop, 'thinking')
      else if (chunk.kind === 'text' && chunk.text.trim()) await phase($, loop, 'writing')
      yield chunk
    }
  })

  on('tool.call', async ($, e, next) => {
    const loop = e.agentId ?? MAIN
    // Our own tool is not among the typed names until the engine lays the types again.
    if ((e.tool as string) === PLAN) {
      const parsed = parsePlan(e as { todos?: unknown })
      if ('error' in parsed) return { deny: parsed.error }
      // Only the main loop's plan is the turn's plan; a subagent's list is its own business.
      if (loop !== MAIN) return { result: 'Plan noted.' }
      await update($, summary, r => fromTodos(r, parsed.todos))
      return { result: planAnswer((await read($, summary))?.plan ?? []) }
    }
    if (loop !== MAIN) await seen($, loop)
    await update($, summary, counted)
    await phase($, loop, 'working', e.tool)
    try {
      const result = await next(e)
      if (loop !== MAIN || 'deny' in result || result.isError) return result
      // Only the main loop's plan is the turn's plan; a subagent's list is its own business.
      if (e.tool === 'TodoWrite') {
        await update($, summary, r => fromTodos(r, e.todos))
      } else if (e.tool === 'TaskCreate') {
        const id = (result.result as { task?: { id?: string } } | undefined)?.task?.id
        if (id) await update($, summary, r => taskCreated(r, id, e.subject, e.activeForm))
      } else if (e.tool === 'TaskUpdate') {
        await update($, summary, r => taskUpdated(r, e))
      }
      return result
    } finally {
      await phase($, loop, 'thinking')
    }
  })

  on('turn.complete', async ($, e, next) => {
    const isFailed = e.reason === 'aborted' || e.reason === 'error'
    if (e.agentId !== undefined) {
      shown.set(e.agentId, isFailed ? 'failed' : 'done')
      await update($, summary, r => agentDone(r, e.agentId!, isFailed))
      const r = await read($, summary)
      if (r && !isLive(r)) {
        stopTick()
        const now = await $.clock.now()
        await update($, summary, s => (s ? { ...s, elapsedMs: now - startedAt } : s))
      }
      return next(e)
    }
    shown.set(MAIN, 'done')
    await update($, summary, r => finish(r, isFailed, e.durationMs))
    const r = await read($, summary)
    if (!r || !isLive(r)) stopTick()
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Whatever else draws in the band (another mod, the engine) stays, below this.
    const below = await next(e)
    const r = await read($, summary)
    if (e.props.hasSurvey || !r) return below

    const { Box, Text } = $.ui.resolve(e)
    const p = progress(r.plan)

    if (!isLive(r)) {
      const agents = r.agents.length
      const parts = [
        p.total ? `${p.done} of ${p.total} steps` : undefined,
        plural(r.calls, 'tool call'),
        agents ? `${plural(agents, 'agent')} (peak ${peak(r)}%)` : undefined,
        seconds(r.elapsedMs),
      ].filter(Boolean)
      return (
        <Box flexDirection="column">
          <Text dimColor wrap="truncate-end">
            {ICON[r.phase]} <Text bold>{r.phase === 'failed' ? 'Stopped' : 'Done'}</Text> · {parts.join(' · ')}
          </Text>
          {below}
        </Box>
      )
    }

    // After the turn, only agents keep the band open: they are what is working.
    const icon = r.isActive ? ICON[r.phase] : ICON.working
    const now = [activity(r), plural(r.calls, 'tool call')].join(' · ')
    const maxRows = e.props.maxRows ?? 16

    // Agents first claim their rows, then the plan takes what is left of the band.
    const team = shownAgents(r.agents, AGENTS)
    const agentRows = team.agents.length + (team.hidden ? 1 : 0)
    const width = Math.max(0, ...team.agents.map(a => a.label.length))
    const agentRow = (a: Agent, isLast: boolean) => {
      const percent = percentOf(a.tokens, r.window)
      return (
        <Text key={a.id} dimColor wrap="truncate-end">
          {'  '}
          {isLast ? '└' : '├'} <Text bold>{a.label.padEnd(width)}</Text>  {meter(percent)} {String(percent).padStart(3)}%{pressure(percent)} {agentDoing(a)}
          {a.type ? `  (${a.type})` : ''}
        </Text>
      )
    }
    const agentList = [
      ...team.agents.map((a, i) => agentRow(a, i === team.agents.length - 1 && !team.hidden)),
      team.hidden ? (
        <Text key="more-agents" dimColor>
          {'  '}└ ⋯ {plural(team.hidden, 'more agent')}
        </Text>
      ) : null,
    ]

    if (!p.total) {
      return (
        <Box flexDirection="column">
          <Text dimColor wrap="truncate-end">
            {icon} <Text bold>{activity(r)}</Text> · {plural(r.calls, 'tool call')} · {seconds(r.elapsedMs)}
          </Text>
          {agentList}
          {below}
        </Box>
      )
    }

    // Header, progress row and a "more" row around the steps.
    const room = Math.max(1, Math.min(STEPS, maxRows - 3 - agentRows))
    const shownSteps = visible(r.plan, p.current, room)
    const row = (s: PlanStep) =>
      s.status === 'in_progress' ? <Text bold>{s.activeForm || s.subject}</Text> : s.subject

    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">
          {icon} <Text bold>{stepTitle(r.plan, p.current)}</Text> · {seconds(r.elapsedMs)}
        </Text>
        <Text dimColor wrap="truncate-end">
          {'  '}step {Math.min(p.current + 1, p.total)} of {p.total}  {bar(p.done / p.total)} {p.percent}% · {now}
        </Text>
        {shownSteps.steps.map(s => (
          <Text key={s.id} dimColor wrap="truncate-end">
            {'  '}
            {STEP_ICON[s.status]} {row(s)}
          </Text>
        ))}
        {shownSteps.after > 0 ? (
          <Text dimColor>
            {'  '}⋯ {shownSteps.after} more
          </Text>
        ) : null}
        {agentList}
        {below}
      </Box>
    )
  })
}
