import { expect, test } from 'claude-code/testing'

test('a turn draws the forecast and what eats the context', async ($, on) => {
  let used = 36_100
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: {
        tokens: used,
        window: 200_000,
        percent: Math.round(used / 2000),
        breakdown: {
          categories: [
            { name: 'System prompt', tokens: 3_100, kind: 'used' },
            { name: 'Messages', tokens: used - 21_300, kind: 'used' },
            { name: 'System tools', tokens: 18_200, kind: 'used' },
            { name: 'Free space', tokens: 200_000 - used, kind: 'free' },
          ],
        },
      },
      rateLimits: [],
    },
  }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'beneath') as never
  })

  const turn = { answer: '', durationMs: 1, isAborted: false, reason: 'answer' as const }
  await $.turn.complete({ ...turn, turnId: 't1' })
  used = 134_400
  await $.turn.complete({ ...turn, turnId: 't2' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'token-weather-v2',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, columns: 120 } as never,
    })
    const texts = await ui.findAll({ type: 'Text' })
    const lines = texts.filter(t => t.props.dimColor).map(t => t.text)
    expect(lines).toEqual([
      '☂ Showers  67% · 134.4k / 200k  ▂▆  ▲ +98.3k last turn',
      '  Messages 113.1k · System tools 18.2k · System prompt 3.1k',
    ])
    for (const t of await ui.findAll({ type: 'Text' })) expect(t.props.color).toBeUndefined()
    const bold = (await ui.findAll({ type: 'Text' })).filter(t => t.props.bold).map(t => t.text)
    expect(bold).toEqual(['Showers', 'Messages', 'System tools', 'System prompt'])
    expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
    await ui.unmount()
  }
})
