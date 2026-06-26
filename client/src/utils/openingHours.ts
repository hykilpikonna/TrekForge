const DAY_MINUTES = 24 * 60

export interface OpeningPoint {
  day?: number
  hour?: number
  minute?: number
}

export interface OpeningPeriod {
  open?: OpeningPoint
  close?: OpeningPoint
}

export interface PlaceOpeningDetails {
  opening_periods?: OpeningPeriod[] | null
  opening_hours?: string[] | null
  business_status?: string | null
  cached_at?: number | null
}

export type OpeningHoursWarningKind =
  | 'closed_permanently'
  | 'closed_temporarily'
  | 'closed_that_day'
  | 'outside_hours'

export interface OpeningHoursWarning {
  kind: OpeningHoursWarningKind
  hoursText?: string
}

interface Interval {
  start: number
  end: number
  allDay?: boolean
}

type ClockFormatter = (clock: string) => string

function parseClockToMinutes(clock?: string | null): number | null {
  if (!clock) return null
  const match = clock.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return hour * 60 + minute
}

function minutesToClock(totalMinutes: number): string {
  const mins = ((Math.round(totalMinutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  const hour = Math.floor(mins / 60)
  const minute = mins % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function googleDayForDate(date?: string | null): number | null {
  if (!date) return null
  const d = new Date(`${date}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return d.getDay()
}

function mondayFirstIndex(googleDay: number): number {
  return googleDay === 0 ? 6 : googleDay - 1
}

function pointMinutes(point?: OpeningPoint): number | null {
  if (!point || typeof point.day !== 'number') return null
  const hour = typeof point.hour === 'number' ? point.hour : 0
  const minute = typeof point.minute === 'number' ? point.minute : 0
  if (point.day < 0 || point.day > 6 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return hour * 60 + minute
}

function intervalsFromPeriods(periods: OpeningPeriod[] | null | undefined, targetGoogleDay: number): Interval[] | null {
  if (!Array.isArray(periods) || periods.length === 0) return null
  const intervals: Interval[] = []

  for (const period of periods) {
    if (!period.open || typeof period.open.day !== 'number') continue
    const openMinute = pointMinutes(period.open)
    if (openMinute == null) continue

    if (!period.close) {
      intervals.push({ start: Number.NEGATIVE_INFINITY, end: Number.POSITIVE_INFINITY, allDay: true })
      continue
    }

    const closeMinute = pointMinutes(period.close)
    if (closeMinute == null || typeof period.close.day !== 'number') continue

    for (const weekOffset of [-7, 0, 7]) {
      const start = (period.open.day - targetGoogleDay + weekOffset) * DAY_MINUTES + openMinute
      let end = (period.close.day - targetGoogleDay + weekOffset) * DAY_MINUTES + closeMinute
      while (end <= start) end += 7 * DAY_MINUTES
      if (end > 0 && start < DAY_MINUTES) intervals.push({ start, end })
    }
  }

  return intervals.length > 0 ? dedupeIntervals(intervals) : []
}

function dedupeIntervals(intervals: Interval[]): Interval[] {
  const seen = new Set<string>()
  return intervals
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .filter((interval) => {
      const key = `${interval.start}:${interval.end}:${interval.allDay ? 1 : 0}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function parseTimeText(text: string, fallbackMeridiem?: string): number | null {
  const match = text.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|am|pm)?$/i)
  if (!match) return null
  let hour = Number(match[1])
  const minute = match[2] ? Number(match[2]) : 0
  const meridiem = (match[3] || fallbackMeridiem || '').toLowerCase().replace(/\./g, '')
  if (minute < 0 || minute > 59) return null
  if (meridiem === 'pm' && hour !== 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  if (hour < 0 || hour > 23) return null
  return hour * 60 + minute
}

function intervalsFromLine(line?: string | null): Interval[] | null {
  if (!line) return null
  const hoursText = line.replace(/^[^:]+:\s*/, '').trim()
  if (!hoursText || /\?/.test(hoursText)) return null
  if (/closed/i.test(hoursText)) return []
  if (/24\/7|open 24 hours|24 hours/i.test(hoursText)) {
    return [{ start: 0, end: DAY_MINUTES, allDay: true }]
  }

  const intervals: Interval[] = []
  const time = String.raw`(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?)`
  const rangeRe = new RegExp(`${time}\\s*(?:-|–|—|to)\\s*${time}`, 'gi')
  for (const match of hoursText.matchAll(rangeRe)) {
    const endMeridiem = match[2]?.match(/(a\.?m\.?|p\.?m\.?|am|pm)$/i)?.[1]
    const start = parseTimeText(match[1], endMeridiem)
    let end = parseTimeText(match[2])
    if (start == null || end == null) continue
    if (end <= start) end += DAY_MINUTES
    intervals.push({ start, end })
  }

  return intervals.length > 0 ? dedupeIntervals(intervals) : null
}

function intervalsFromDescriptions(openingHours: string[] | null | undefined, targetGoogleDay: number): Interval[] | null {
  if (!Array.isArray(openingHours) || openingHours.length === 0) return null
  return intervalsFromLine(openingHours[mondayFirstIndex(targetGoogleDay)])
}

function formatIntervals(intervals: Interval[], formatClock: ClockFormatter): string | undefined {
  if (intervals.some((interval) => interval.allDay || (interval.start <= 0 && interval.end >= DAY_MINUTES))) {
    return 'Open 24 hours'
  }
  const dayIntervals = intervals.filter((interval) => interval.end > 0 && interval.start < DAY_MINUTES)
  if (dayIntervals.length === 0) return undefined
  return dayIntervals
    .map((interval) => `${formatClock(minutesToClock(interval.start))}-${formatClock(minutesToClock(interval.end))}`)
    .join(', ')
}

function visitRange(startTime?: string | null, endTime?: string | null): { start: number; end: number } | null {
  const start = parseClockToMinutes(startTime)
  const endRaw = parseClockToMinutes(endTime)
  if (start == null || endRaw == null) return null
  return { start, end: endRaw <= start ? endRaw + DAY_MINUTES : endRaw }
}

export function getOpeningHoursWarning(
  details: PlaceOpeningDetails | null | undefined,
  dayDate: string | null | undefined,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  formatClock: ClockFormatter = (clock) => clock,
): OpeningHoursWarning | null {
  if (!details) return null

  const businessStatus = String(details.business_status || '').toUpperCase()
  if (businessStatus === 'CLOSED_PERMANENTLY') return { kind: 'closed_permanently' }
  if (businessStatus === 'CLOSED_TEMPORARILY') return { kind: 'closed_temporarily' }

  const day = googleDayForDate(dayDate)
  const visit = visitRange(startTime, endTime)
  if (day == null || !visit) return null

  const intervals = intervalsFromPeriods(details.opening_periods, day)
    ?? intervalsFromDescriptions(details.opening_hours, day)
  if (!intervals) return null
  if (intervals.some((interval) => interval.allDay)) return null
  if (intervals.length === 0) return { kind: 'closed_that_day' }
  if (intervals.some((interval) => interval.start <= visit.start && interval.end >= visit.end)) return null

  return { kind: 'outside_hours', hoursText: formatIntervals(intervals, formatClock) }
}
