import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'workflow-radar',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 12, columns: 120 } as never,
} as const

type Ui = { findAll: (q: { type: string }) => Promise<{ text: string; props: Record<string, unknown> }[]> }

const lines = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).filter(t => t.props.dimColor).map(t => t.text)

const todos = [
  { content: 'Pick the page style', status: 'completed', activeForm: 'Picking the page style' },
  { content: 'Check live weather', status: 'in_progress', activeForm: 'Checking live weather' },
  { content: 'Build the dashboard', status: 'pending', activeForm: 'Building the dashboard' },
  { content: 'Publish it', status: 'pending', activeForm: 'Publishing it' },
]

test('the band sums up the turn and follows the plan', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  const seen: string[][] = []
  on('tool.call', async (_, e) => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    seen.push(await lines(ui as never))
    expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
    await ui.unmount()
    return { result: e.tool === 'TodoWrite' ? { oldTodos: [], newTodos: (e as never as { todos: unknown }).todos } : 'ok', text: 'ok' } as never
  })
  on('clock.now', () => ({ value: 0 }) as never)
  on('session.usage', () => ({ value: { context: { window: 200_000 } } }) as never)
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'Find weather APIs', type: 'Explore', status: 'running' }],
  }) as never)
  on('turn.step', async function* (_, e) {
    yield { kind: 'thinking', index: 0, text: 'hmm' }
    return {
      turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use',
      usage: { model: 'm', input_tokens: 0, output_tokens: 5, cache_read_input_tokens: 70_000, cache_creation_input_tokens: 6_000 },
    }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await $.turn.start({ text: 'Build a weather dashboard for New York', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'u1', command: 'ls' } as never)
  expect(seen[0]).toEqual(['⚙ running Bash · 1 tool call · 0s'])

  await $.tool.call({ tool: 'TodoWrite', tool_use_id: 'u2', todos } as never)
  await $.tool.call({ tool: 'Read', tool_use_id: 'u3', file_path: '/a/b.ts' } as never)
  expect(seen[2]).toEqual([
    '⚙ Checking live weather · 0s',
    '  step 2 of 4  █████░░░░░░░░░░░░░░░ 25% · running Read · 3 tool calls',
    '  ✓ Pick the page style',
    '  ● Checking live weather',
    '  ○ Build the dashboard',
    '  ○ Publish it',
  ])

  // A subagent makes a model call, then a tool call of its own.
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1, agentId: 'a1' } as never)) {
    // drain
  }
  await $.tool.call({ tool: 'WebFetch', tool_use_id: 'u4', url: 'https://x', agentId: 'a1' } as never)
  expect(seen[3]).toEqual([
    '✻ Checking live weather · 0s',
    '  step 2 of 4  █████░░░░░░░░░░░░░░░ 25% · 1 agent working · 4 tool calls',
    '  ✓ Pick the page style',
    '  ● Checking live weather',
    '  ○ Build the dashboard',
    '  ○ Publish it',
    '  └ Find weather APIs  ▰▰▰▱▱▱▱▱  38%  running WebFetch  (Explore)',
  ])
  await $.turn.complete({ answer: '', durationMs: 3_000, isAborted: false, reason: 'answer', turnId: 't1', agentId: 'a1' } as never)

  await $.turn.complete({ answer: '', durationMs: 12_000, isAborted: false, reason: 'answer', turnId: 't1' })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await lines(ui as never)).toEqual(['✓ Done · 1 of 4 steps · 4 tool calls · 1 agent (peak 38%) · 12s'])
})

test('a background agent keeps the band open after the turn ends', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('clock.now', () => ({ value: 0 }) as never)
  on('session.usage', () => ({ value: { context: { window: 200_000 } } }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }) as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await $.turn.start({ text: 'Find weather APIs', turnId: 't1' })
  await $.agent.spawn({ prompt: 'look', description: 'Find weather APIs', subagentType: 'Explore' } as never)
  await $.turn.complete({ answer: '', durationMs: 2_000, isAborted: false, reason: 'answer', turnId: 't1' })

  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await lines(ui as never)).toEqual([
    '⚙ 1 agent working · 0 tool calls · 2s',
    '  └ Find weather APIs  ▱▱▱▱▱▱▱▱   0%  thinking  (Explore)',
  ])
  await ui.unmount()

  // The next turn starts while the agent still runs: it stays listed.
  await $.turn.start({ text: 'and?', turnId: 't2' })
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await lines(ui as never)).at(-1)).toBe('  └ Find weather APIs  ▱▱▱▱▱▱▱▱   0%  thinking  (Explore)')
  await ui.unmount()
  await $.turn.complete({ answer: '', durationMs: 1_000, isAborted: false, reason: 'answer', turnId: 't2' })

  await $.turn.complete({ answer: '', durationMs: 9_000, isAborted: false, reason: 'answer', turnId: 't1', agentId: 'a1' } as never)
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await lines(ui as never)).toEqual(['✓ Done · 0 tool calls · 1 agent (peak 0%) · 0s'])
})
