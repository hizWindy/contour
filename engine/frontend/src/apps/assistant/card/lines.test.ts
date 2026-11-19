/**
 * What the card says once (PLAN-V23 T1-6), and the name it teaches (T1-5): plain code, each case.
 * Made-up names only: Sample Logistics Pty Ltd, Northwind Pty Ltd, North Wind (as misheard).
 */
import { describe, expect, it } from 'vitest'
import { draftOf, NO_COMPANY, type CardDraft } from './draft'
import { callCommand, emailCommand, NORTHWIND, SAMPLE, taskCommand } from './fixtures'
import { cardLinesOf, companyLinesOf, unsureLeft } from './lines'

function draft(made = taskCommand()): CardDraft {
  const result = draftOf({ command: made, words: 'the words', source: 'mic' }, null)
  if (!result) throw new Error('No draft')
  return result
}

const NOT_THERE = "North Wind isn't in HubSpot. Add it, or pick another company."

describe('the lines the parts say themselves', () => {
  it('the company: new in HubSpot, nowhere, not found, or which', () => {
    expect(companyLinesOf({ ...NO_COMPANY, heard: 'North Wind', canAdd: true })).toEqual([
      NOT_THERE,
    ])
    expect(companyLinesOf({ ...NO_COMPANY, heard: 'North Wind' })).toEqual([
      "We couldn't find 'North Wind' in HubSpot. Pick the company.",
    ])
    expect(
      companyLinesOf({ ...NO_COMPANY, found: NORTHWIND, heard: 'Northwind', fromHubspot: true }),
    ).toEqual(["Northwind Pty Ltd is new in HubSpot. We'll use it."])
    expect(companyLinesOf({ ...NO_COMPANY, found: SAMPLE, heard: 'Sample' })).toEqual([])
    expect(
      companyLinesOf({ ...NO_COMPANY, choices: [SAMPLE, NORTHWIND], heard: 'Sample' }),
    ).toEqual(['Which Sample?'])
    expect(companyLinesOf({ ...NO_COMPANY, found: SAMPLE, added: true })).toEqual([
      'Added to HubSpot.',
    ])
  })

  it('a call’s person, and an email’s teammates, when there is a choice', () => {
    const call = draft(
      callCommand({
        person: {
          found: null,
          choices: [{ id: 'c-2', name: 'James Sample', title: null }],
          heard: 'James',
        },
      }),
    )
    expect(cardLinesOf(call)).toEqual(['Which James?'])
    const email = draft(
      emailCommand({
        email: {
          to: [{ heard: 'Sam', found: null, choices: [], address: null, problem: null }],
          subject: 'x',
          body: 'y',
        },
      }),
    )
    expect(cardLinesOf(email)).toEqual([])
  })

  it('the server’s paragraph leaves them out, and is gone when nothing is left', () => {
    expect(unsureLeft(`${NOT_THERE} Two people named Jo work there.`, [NOT_THERE])).toBe(
      'Two people named Jo work there.',
    )
    expect(unsureLeft(NOT_THERE, [NOT_THERE])).toBeNull()
    expect(unsureLeft(null, [NOT_THERE])).toBeNull()
    expect(unsureLeft('Something else.', [])).toBe('Something else.')
  })
})
