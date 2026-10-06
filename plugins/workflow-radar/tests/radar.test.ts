import { describe as group, expect, test } from 'claude-code/testing'

import {
  activity,
  addAgent,
  agentDone,
  agentTokens,
  bar,
  begin,
  contextOf,
  finish,
  isLive,
  fromTodos,
  meter,
  peak,
  pressure,
  reconcile,
  progress,
  seconds,
  shownAgents,
  taskCreated,
  taskUpdated,
  visible,
} from '../hooks/radar'

const todos = [
  { content: 'Pick the page style', status: 'completed' as const, activeForm: 'Picking the page style' },
  { content: 'Check live weather', status: 'in_progress' as const, activeForm: 'Checking live weather' },
  { content: 'Build the dashboard', status: 'pending' as const, activeForm: 'Building the dashboard' },
  { content: 'Publish it', status: 'pending' as const, activeForm: 'Publishing it' },
]

group('summary', () => {
  test('a todo list becomes the plan, and progress counts what is done', async () => {
    const r = fromTodos(begin(null), todos)
    expect(progress(r.plan)).toEqual({ done: 1, total: 4, current: 1, percent: 25 })
    expect(bar(0.25, 8)).toBe('██░░░░░░')
  })

  test('tasks are created, updated and deleted', async () => {
    let r = taskCreated(begin(null), '1', 'Write tests')
    r = taskCreated(r, '2', 'Fix bug')
    r = taskUpdated(r, { taskId: '1', status: 'completed' })
    r = taskUpdated(r, { taskId: '2', status: 'deleted' })
    expect(r.plan.map(s => [s.id, s.status])).toEqual([['1', 'completed']])
  })

  test('an open plan carries into the next turn, a finished one does not', async () => {
    const open = fromTodos(begin(null), todos)
    expect(begin(open).plan).toHaveLength(4)
    const done = fromTodos(open, todos.map(t => ({ ...t, status: 'completed' as const })))
    expect(begin(done).plan).toHaveLength(0)
  })

  test('the window keeps the step before the current one in view', async () => {
    const plan = Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, subject: `s${i}`, status: 'pending' as const }))
    const w = visible(plan, 5, 4)
    expect(w.steps.map(s => s.id)).toEqual(['4', '5', '6', '7'])
    expect([w.before, w.after]).toEqual([4, 2])
  })

  test('activity sums up, and agents win over the main loop', async () => {
    let r = begin(null)
    expect(activity(r)).toBe('thinking')
    r = addAgent(r, 'a1', 'Find auth code', 'Explore')
    expect(activity(r)).toBe('1 agent working')
    r = agentDone(r, 'a1', false)
    expect(activity(r)).toBe('thinking')
    r = finish(r, false, 65_000)
    expect(r.isActive).toBe(false)
    expect(seconds(r.elapsedMs)).toBe('1m 5s')
  })

  test("an agent's context is its last call's input, measured against the window", async () => {
    expect(contextOf({ input_tokens: 10, cache_read_input_tokens: 70_000, cache_creation_input_tokens: 6_000 })).toBe(76_010)
    let r = begin(null, 200_000)
    r = addAgent(r, 'a1', 'Find weather APIs', 'Explore')
    r = addAgent(r, 'a2', 'Explore page styles', 'Explore')
    r = agentTokens(r, 'a1', 76_000)
    r = agentTokens(r, 'a2', 18_000)
    expect(peak(r)).toBe(38)
    expect(meter(38)).toBe('▰▰▰▱▱▱▱▱')
    expect([pressure(50), pressure(75), pressure(95)]).toEqual([' ', '▲', '⚠'])
  })

  test('running agents are listed first, the rest counted', async () => {
    let r = begin(null)
    for (const id of ['a', 'b', 'c', 'd', 'e']) r = addAgent(r, id, id, '')
    r = agentDone(r, 'a', false)
    const s = shownAgents(r.agents, 4)
    expect(s.agents.map(a => a.id)).toEqual(['b', 'c', 'd', 'e'])
    expect(s.hidden).toBe(1)
  })

  test('a new turn keeps the agents still running and drops the finished ones', async () => {
    let r = begin(null)
    r = addAgent(r, 'a', 'Find weather APIs', 'Explore')
    r = addAgent(r, 'b', 'Explore page styles', 'Explore')
    r = agentDone(r, 'b', false)
    expect(begin(r).agents.map(a => a.id)).toEqual(['a'])
  })

  test('the band stays live while an agent runs after the main loop finished', async () => {
    let r = addAgent(begin(null), 'a', 'Find weather APIs', 'Explore')
    r = finish(r, false, 5_000)
    expect(isLive(r)).toBe(true)
    expect(activity(r)).toBe('1 agent working')
    r = agentDone(r, 'a', false)
    expect(isLive(r)).toBe(false)
  })

  test('agents the session no longer runs are closed', async () => {
    let r = begin(null)
    for (const id of ['a', 'b', 'c', 'd']) r = addAgent(r, id, id, '')
    r = reconcile(r, [
      { id: 'a', status: 'running' },
      { id: 'b', status: 'completed' },
      { id: 'c', status: 'killed' },
    ])
    expect(r.agents.map(a => [a.id, a.status])).toEqual([
      ['a', 'running'],
      ['b', 'done'],
      ['c', 'failed'],
      ['d', 'running'],
    ])
  })
})
