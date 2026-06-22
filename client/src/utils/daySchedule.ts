import type { Assignment, Day } from '../types'
import { parseTimeToMinutes } from './dayMerge'

export const DEFAULT_WAKE_UP_TIME = '08:00'
const DAY_MINUTES = 24 * 60

export interface ActivityTimeSlot {
  start: string
  end: string
  durationMinutes: number
}

export interface ActivityScheduleTravel {
  initialTravelMinutes?: number
  travelAfterAssignmentMinutes?: Record<number, number | undefined>
  finalTravelMinutes?: number
  scheduleMarginMinutes?: number
}

function wakeMinutes(day?: Pick<Day, 'wake_up_time'> | null): number {
  return parseTimeToMinutes(day?.wake_up_time) ?? parseTimeToMinutes(DEFAULT_WAKE_UP_TIME)!
}

function assignmentDurationMinutes(assignment: Assignment): number {
  return normalizeDurationMinutes(assignment.duration_minutes ?? assignment.place?.duration_minutes)
}

export function normalizeScheduleMarginMinutes(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

export function normalizeDurationMinutes(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 60
}

export function minutesToClock(totalMinutes: number): string {
  const mins = ((Math.round(totalMinutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function formatDurationMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

function normalizeTravelMinutes(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

export function buildActivitySchedule(
  day: Pick<Day, 'wake_up_time'>,
  assignments: Assignment[],
  travel: ActivityScheduleTravel = {},
): Record<number, ActivityTimeSlot> {
  const scheduleMargin = normalizeScheduleMarginMinutes(travel.scheduleMarginMinutes)
  const initialTravel = normalizeTravelMinutes(travel.initialTravelMinutes)
  let cursor = wakeMinutes(day) + initialTravel + (initialTravel > 0 ? scheduleMargin : 0)
  const slots: Record<number, ActivityTimeSlot> = {}
  for (const assignment of assignments) {
    const duration = assignmentDurationMinutes(assignment)
    slots[assignment.id] = {
      start: minutesToClock(cursor),
      end: minutesToClock(cursor + duration),
      durationMinutes: duration,
    }
    const nextTravel = normalizeTravelMinutes(travel.travelAfterAssignmentMinutes?.[assignment.id])
    cursor += duration + scheduleMargin + nextTravel + (nextTravel > 0 ? scheduleMargin : 0)
  }
  return slots
}

export function getMaxSleepMinutes(
  day: Pick<Day, 'wake_up_time'>,
  assignments: Assignment[],
  nextDay?: Pick<Day, 'wake_up_time'> | null,
  travel: ActivityScheduleTravel = {},
): number {
  const scheduleMargin = normalizeScheduleMarginMinutes(travel.scheduleMarginMinutes)
  const initialTravel = normalizeTravelMinutes(travel.initialTravelMinutes)
  let end = wakeMinutes(day) + initialTravel + (initialTravel > 0 ? scheduleMargin : 0)
  for (const assignment of assignments) {
    const nextTravel = normalizeTravelMinutes(travel.travelAfterAssignmentMinutes?.[assignment.id])
    end += assignmentDurationMinutes(assignment) + scheduleMargin + nextTravel + (nextTravel > 0 ? scheduleMargin : 0)
  }
  const finalTravel = normalizeTravelMinutes(travel.finalTravelMinutes)
  end += finalTravel + (finalTravel > 0 ? scheduleMargin : 0)
  const nextWake = wakeMinutes(nextDay ?? day)
  let nextWakeAbsolute = DAY_MINUTES + nextWake
  while (nextWakeAbsolute < end) nextWakeAbsolute += DAY_MINUTES
  return Math.max(0, nextWakeAbsolute - end)
}
