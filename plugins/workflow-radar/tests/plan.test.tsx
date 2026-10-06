import { expect, test } from 'claude-code/testing'

const PLAN = 'mcp__workflow-radar__plan'

const BAND = {
  plugin: 'workflow-radar',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 12, columns: 120 } as never,
} as const

type Ui = { findAll: (q: { type: string }) => Promise<{ text: string; props: Record<string, unknown> }[]> }

const lines = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).filter(t => t.props.dimColor).map(t => t.text)

const steps = [
  { content: 'Pick the page style', status: 'completed', activeForm: 'Picking the page style' },
  { content: 'Check live weather', status: 'in_progress', activeForm: 'Checking live weather' },
  { content: 'Build the dashboard', status: 'pending', activeForm: 'Building the dashboard' },
]

test('the plan tool is registered, taught, and drawn as the plan', async ($, on) => {
  const registered: string[] = []
  on('tool.register', (_, e) => {
    registered.push((e as { name: string }).name)
    return { value: { tool: PLAN } } as never
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' }] }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('clock.now', () => ({ value: 0 }) as never)
  on('session.usage', () => ({ value: { context: { window: 200_000 } } }) as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  await $.session.start({ cwd: '/w', surface: 'desktop', isInteractive: true } as never)
  expect(registered).toEqual(['plan'])

  const composed = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], outputStyle: null, traits: [], tools: [PLAN] } as never)
  expect(composed.sections.at(-1)?.id).toBe('workflow-radar:plan')
  const without = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], outputStyle: null, traits: [], tools: [] } as never)
  expect(without.sections.map(s => s.id)).toEqual(['intro'])

  await $.turn.start({ text: 'Build a weather dashboard', turnId: 't1' })
  const answer = await $.tool.call({ tool: PLAN, tool_use_id: 'u1', todos: steps } as never)
  expect('deny' in answer).toBe(false)
  expect(answer.text ?? JSON.stringify(answer.result)).toContain('1 of 3')

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await lines(ui as never)).toEqual([
    '✻ Checking live weather · 0s',
    '  step 2 of 3  ███████░░░░░░░░░░░░░ 33% · thinking · 0 tool calls',
    '  ✓ Pick the page style',
    '  ● Checking live weather',
    '  ○ Build the dashboard',
  ])
})

test('a malformed plan is refused', async ($, on) => {
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('clock.now', () => ({ value: 0 }) as never)
  on('session.usage', () => ({ value: { context: { window: 200_000 } } }) as never)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const answer = await $.tool.call({ tool: PLAN, tool_use_id: 'u1', todos: [{ status: 'done' }] } as never)
  expect(answer.isError ?? 'deny' in answer).toBe(true)
})
