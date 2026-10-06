import { expect, test } from 'claude-code/testing'

test('a long stream passes through quickly', async ($, on) => {
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    yield { kind: 'thinking', index: 0, text: 'hmm' }
    for (let i = 0; i < 500; i++) yield { kind: 'text', index: 1, text: `word ${i} ` }
    yield { kind: 'tool', index: 2, id: 'u1', name: 'Read' }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }
  })
  await $.turn.start({ text: 'go', turnId: 't1' })
  const t0 = Date.now()
  let n = 0
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 } as never)) n++
  expect(n).toBe(502)
})
