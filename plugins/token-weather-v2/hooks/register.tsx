import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Forecast } from '../types'
import { delta, push, sky, sparkline, tokens, top } from './weather'

const forecast = atom({ plugin: 'token-weather-v2', key: 'forecast' } as const, null)

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Only the main loop's turns fill the session's window.
    if (e.agentId !== undefined) return result

    // `summary` estimates the categories locally, as /context does, with no API call.
    const { context } = await $.session.usage({ breakdown: 'summary' })
    if (context.tokens !== undefined) {
      const used = context.tokens
      const eaters = (context.breakdown?.categories ?? [])
        .filter(c => c.kind === 'used')
        .map(c => ({ name: c.name, tokens: c.tokens }))
      await update($, forecast, (f): Forecast => ({
        history: push(f?.history ?? [], used),
        window: context.window,
        eaters,
      }))
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Whatever else draws in the band (another mod, the engine) stays, below this.
    const below = await next(e)
    const f = await read($, forecast)
    const used = f?.history[f.history.length - 1]
    if (e.props.hasSurvey || !f || used === undefined || f.window <= 0) {
      return below
    }

    const { Box, Text } = $.ui.resolve(e)
    const percent = Math.round((used / f.window) * 100)
    const s = sky(percent)
    const change = delta(f.history)
    const eats = top(f.eaters)

    return (
      <Box flexDirection="column">
        <Text dimColor>
          {s.icon} <Text bold>{s.word}</Text>  {percent}% · {tokens(used)} / {tokens(f.window)}  {sparkline(f.history, f.window)}
          {change ? `  ${change}` : ''}
        </Text>
        {eats.length > 0 ? (
          <Text dimColor wrap="truncate-end">
            {'  '}
            {eats.map((eater, i) => (
              <Text key={eater.name}>
                {i > 0 ? ' · ' : ''}
                <Text bold>{eater.name}</Text> {tokens(eater.tokens)}
              </Text>
            ))}
          </Text>
        ) : null}
        {below}
      </Box>
    )
  })
}
