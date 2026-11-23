import { describe, expect, it } from 'vitest'
import { fixNames, soundKey } from './name-fix'

/*
  The name fix for a voice tool that writes names in any case (PLAN-V24 choice 28): the model on
  the device writes "sample logistics". The browser service's mode, with its capital-letter rule, is
  tested in voice-tool.test.ts and doesn't change. Made-up names only.
*/

const NAMES = ['Sample Logistics Pty Ltd', 'Jo Sample', 'Vitera Pty Ltd']

const any = (text: string, names: readonly string[] = NAMES) => fixNames(text, names, 'any')

describe('the name fix, for a tool that writes names in any case', () => {
  it("gives a run of words that is a name its own capitals, and doesn't call that a fix", () => {
    expect(any('log a call with sample logistics')).toEqual({
      text: 'log a call with Sample Logistics',
      fixes: [],
    })
    expect(any('jo sample wants a follow up next tuesday').text).toBe(
      'Jo Sample wants a follow up next tuesday',
    )
    expect(any('SAMPLE LOGISTICS PTY LTD called back.').text).toBe(
      'Sample Logistics Pty Ltd called back.',
    )
    expect(any('spoke to jo sample at sample logistics').text).toBe(
      'spoke to Jo Sample at Sample Logistics',
    )
    expect(any('vitera pty ltd wants more room').text).toBe('Vitera Pty Ltd wants more room')
  })

  it('fixes one near miss in a run when the rest of the run is the name, and says which', () => {
    expect(any('log a call with sample logistix')).toEqual({
      text: 'log a call with Sample Logistics',
      fixes: [{ from: 'logistix', to: 'Logistics' }],
    })
    expect(any('jo sampel called')).toEqual({
      text: 'Jo Sample called',
      fixes: [{ from: 'sampel', to: 'Sample' }],
    })
  })

  it('never changes a word alone, a run cut by a comma, or a run with two words off', () => {
    for (const text of [
      'send a sample',
      'Sample sizes are fine.',
      'the vitara lease',
      'Vitara called.',
      'sample, logistics',
      'a sample of logistics',
      'sampel logistix',
      'jo',
    ]) {
      expect(any(text)).toEqual({ text, fixes: [] })
    }
  })

  it('never turns a real English word into a name', () => {
    // Each everyday word sits one letter off a name's word, next to the rest of that name.
    const pairs = [
      ['shall', 'Shell'],
      ['parts', 'Ports'],
      ['posts', 'Ports'],
      ['simple', 'Sample'],
      ['still', 'Stall'],
      ['staff', 'Stuff'],
      ['mark', 'Marc'],
      ['park', 'Parc'],
      ['north', 'Nortn'],
      ['sales', 'Seles'],
      ['lease', 'Leese'],
      ['level', 'Lever'],
      ['floor', 'Flour'],
      ['metro', 'Metra'],
      ['spring', 'Sprint'],
      ['stock', 'Stork'],
      ['water', 'Waters'],
      ['house', 'Hause'],
      ['power', 'Powel'],
      ['smart', 'Smarts'],
    ] as const
    for (const [word, name] of pairs) {
      for (const text of [
        `we need ${word} logistics`,
        `${word} logistics`,
        `${word.toUpperCase()} LOGISTICS`,
        `the ${word} came today`,
      ]) {
        expect(any(text, [`${name} Logistics`]), text).toEqual({ text, fixes: [] })
      }
    }
  })

  it('never takes everyday words for a name, even when a name on the call is made of them', () => {
    for (const [text, name] of [
      ['we need more office space', 'Office Space Pty Ltd'],
      ['sample yards australia wide', 'Sample Yards Australia'],
      ['the good sample', 'The Good Sample'],
      ['we shall see', 'Small'],
      ['Shall we meet on monday', 'Small Sample Australia'],
    ] as const) {
      expect(any(text, [name]), text).toEqual({ text, fixes: [] })
    }
  })

  it("leaves the browser service's mode as it was: small letters there are never a name", () => {
    expect(fixNames('log a call with sample logistics', NAMES)).toEqual({
      text: 'log a call with sample logistics',
      fixes: [],
    })
    expect(fixNames('Spoke to Jo at Vitara about the lease', NAMES, 'capitals').fixes).toEqual([
      { from: 'Vitara', to: 'Vitera' },
    ])
  })
})

/*
  Sounds like (PLAN-V25 T4-2, choice 17): a capitalised word that sounds like one name, as
  Australians say it, and the "said like" list. Made-up names, and real Australian places.
*/
describe('sounds like, and said like', () => {
  const PLACES = ['Prahran', 'Melbourne', 'Parramatta', 'Sample Logistics Pty Ltd', 'Shell']

  it('fixes a place said the Australian way, by its sound', () => {
    expect(fixNames('Meeting in Prarn on Friday', PLACES)).toEqual({
      text: 'Meeting in Prahran on Friday',
      fixes: [{ from: 'Prarn', to: 'Prahran' }],
    })
    expect(fixNames('Their office in Melbun', PLACES).text).toBe('Their office in Melbourne')
    expect(fixNames('The Paramatta site', PLACES).text).toBe('The Parramatta site')
  })

  it('fixes a name on the said-like list, in any case, and shows the fix once', () => {
    expect(fixNames('pran office, then Pran again', PLACES)).toEqual({
      text: 'Prahran office, then Prahran again',
      fixes: [
        { from: 'pran', to: 'Prahran' },
        { from: 'Pran', to: 'Prahran' },
      ],
    })
    expect(fixNames('Pran and Pran', PLACES).fixes).toHaveLength(1)
    expect(fixNames('pran', PLACES, 'any').text).toBe('Prahran')
  })

  it('never changes an everyday word, by spelling or by sound', () => {
    for (const text of ['Shall we meet?', 'shall we meet', 'Sharp move.', 'Plan the fitout.']) {
      expect(fixNames(text, PLACES)).toEqual({ text, fixes: [] })
      expect(fixNames(text, PLACES, 'any')).toEqual({ text, fixes: [] })
    }
  })

  it('leaves a word that sounds like two names as it was', () => {
    expect(fixNames('Call Sean', ['Shaun', 'Shawn']).text).toBe('Call Sean')
  })

  it('makes the sound key as Australians say the word', () => {
    expect(soundKey('Prahran')).toBe(soundKey('Pran'))
    expect(soundKey('Prahran')).toBe(soundKey('Prarn'))
    expect(soundKey('Phillip')).toBe(soundKey('Filip'))
    // Simple and Sample sound alike to the key, so the everyday-word guard keeps "Simple".
    expect(soundKey('Sample')).toBe(soundKey('Simple'))
    expect(fixNames('Simple plan', ['Sample Logistics Pty Ltd']).text).toBe('Simple plan')
  })
})
