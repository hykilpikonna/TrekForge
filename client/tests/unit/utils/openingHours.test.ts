import { describe, expect, it } from 'vitest'
import { getOpeningHoursWarning } from '../../../src/utils/openingHours'

describe('openingHours warnings', () => {
  it('does not warn when the visit fits inside Google structured hours', () => {
    const warning = getOpeningHoursWarning(
      {
        opening_periods: [
          { open: { day: 1, hour: 10, minute: 0 }, close: { day: 1, hour: 18, minute: 30 } },
        ],
      },
      '2025-06-02',
      '10:30',
      '12:00',
    )

    expect(warning).toBeNull()
  })

  it('warns when the visit ends after closing time', () => {
    const warning = getOpeningHoursWarning(
      {
        opening_periods: [
          { open: { day: 1, hour: 10, minute: 0 }, close: { day: 1, hour: 18, minute: 30 } },
        ],
      },
      '2025-06-02',
      '18:00',
      '19:00',
    )

    expect(warning).toEqual({ kind: 'outside_hours', hoursText: '10:00-18:30' })
  })

  it('handles overnight opening periods from the previous day', () => {
    const warning = getOpeningHoursWarning(
      {
        opening_periods: [
          { open: { day: 5, hour: 22, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } },
        ],
      },
      '2025-06-07',
      '01:00',
      '01:30',
    )

    expect(warning).toBeNull()
  })

  it('treats structured hours with no target-day interval as closed that day', () => {
    const warning = getOpeningHoursWarning(
      {
        opening_periods: [
          { open: { day: 1, hour: 10, minute: 0 }, close: { day: 1, hour: 18, minute: 0 } },
        ],
      },
      '2025-06-08',
      '11:00',
      '12:00',
    )

    expect(warning).toEqual({ kind: 'closed_that_day' })
  })

  it('warns for permanently closed places even without hours', () => {
    const warning = getOpeningHoursWarning(
      { business_status: 'CLOSED_PERMANENTLY' },
      '2025-06-02',
      '10:00',
      '11:00',
    )

    expect(warning).toEqual({ kind: 'closed_permanently' })
  })

  it('falls back to weekday description strings', () => {
    const warning = getOpeningHoursWarning(
      {
        opening_hours: [
          'Monday: 9:00 AM – 5:00 PM',
          'Tuesday: 9:00 AM – 5:00 PM',
          'Wednesday: 9:00 AM – 5:00 PM',
          'Thursday: 9:00 AM – 5:00 PM',
          'Friday: 9:00 AM – 5:00 PM',
          'Saturday: Closed',
          'Sunday: Closed',
        ],
      },
      '2025-06-07',
      '10:00',
      '11:00',
    )

    expect(warning).toEqual({ kind: 'closed_that_day' })
  })
})
