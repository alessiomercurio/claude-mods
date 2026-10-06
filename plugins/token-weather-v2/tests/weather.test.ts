import { describe, expect, test } from 'claude-code/testing'

import { delta, push, sky, sparkline, tokens, top } from '../hooks/weather'

describe('weather', () => {
  test('sky follows the thresholds', async () => {
    expect(sky(0).word).toBe('Clear')
    expect(sky(24).icon).toBe('☀')
    expect(sky(25).word).toBe('Cloudy')
    expect(sky(50).word).toBe('Showers')
    expect(sky(75).word).toBe('Storm')
    expect(sky(89).word).toBe('Storm')
    expect(sky(90).word).toBe('Compact soon')
  })

  test('tokens format like the spec', async () => {
    expect(tokens(134_400)).toBe('134.4k')
    expect(tokens(200_000)).toBe('200k')
    expect(tokens(1_000_000)).toBe('1M')
  })

  test('chart and delta', async () => {
    expect(sparkline([0, 100_000, 200_000], 200_000)).toBe('▁▅█')
    expect(delta([36_100, 134_400])).toBe('▲ +98.3k last turn')
    expect(delta([5])).toBe(null)
    expect(top([{ name: 'A', tokens: 1_000 }, { name: 'B', tokens: 0 }, { name: 'C', tokens: 5_000 }]).map(e => e.name)).toEqual(['C', 'A'])
    expect(push([...Array(12).keys()], 99)).toHaveLength(12)
  })
})
