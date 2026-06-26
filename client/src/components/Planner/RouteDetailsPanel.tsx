import { Bike, Car, Clock, Coins, Footprints, MapPin, Train, X } from 'lucide-react'
import type { RouteSegment, RouteStep } from '../../types'

export type PlannerRouteDetailsProfile = 'driving' | 'walking' | 'transit'

export interface PlannerRouteDetailsSelection {
  key: string
  profile: PlannerRouteDetailsProfile
  title: string
  subtitle?: string
  fromLabel: string
  toLabel: string
  dayTitle?: string | null
  segment: RouteSegment
}

function durationText(seg: RouteSegment, profile: PlannerRouteDetailsProfile): string {
  return seg.durationText ?? (profile === 'walking' ? seg.walkingText : seg.drivingText)
}

function modeIcon(mode: RouteStep['mode'], profile: PlannerRouteDetailsProfile) {
  if (mode === 'transit') return Train
  if (mode === 'walking') return Footprints
  if (mode === 'cycling') return Bike
  if (profile === 'transit') return Train
  if (profile === 'walking') return Footprints
  return Car
}

function safeColor(value?: string | null): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed
  if (/^[0-9a-f]{3,8}$/i.test(trimmed)) return `#${trimmed}`
  return undefined
}

function lineLabel(step: RouteStep): string {
  const line = step.transit?.line
  return line?.shortName || line?.name || line?.serviceName || line?.vehicleType || 'Transit'
}

function stepMeta(step: RouteStep): string {
  return [step.durationText, step.distanceText].filter(Boolean).join(' · ')
}

function stopText(step: RouteStep): string | null {
  const departure = step.transit?.departureStop?.name
  const arrival = step.transit?.arrivalStop?.name
  if (departure && arrival) return `${departure} to ${arrival}`
  return departure || arrival || null
}

function isMergeableWalkStep(step: RouteStep): boolean {
  return step.mode === 'walking' && !step.transit
}

function sumFinite(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number => Number.isFinite(value))
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) : null
}

function formatStepDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`
}

function formatStepDuration(seconds: number): string {
  const roundedMinutes = Math.max(1, Math.round(seconds / 60))
  if (roundedMinutes < 60) return `${roundedMinutes} min`
  const hours = Math.floor(roundedMinutes / 60)
  const minutes = roundedMinutes % 60
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`
}

function mergeWalkingRun(run: RouteStep[]): RouteStep {
  if (run.length === 1) return run[0]
  const distance = sumFinite(run.map(step => step.distance))
  const duration = sumFinite(run.map(step => step.duration))
  return {
    mode: 'walking',
    instruction: 'Walk',
    distance,
    duration,
    distanceText: distance !== null ? formatStepDistance(distance) : run.find(step => step.distanceText)?.distanceText ?? null,
    durationText: duration !== null ? formatStepDuration(duration) : run.find(step => step.durationText)?.durationText ?? null,
  }
}

function mergeConsecutiveWalkingSteps(steps: RouteStep[]): RouteStep[] {
  const merged: RouteStep[] = []
  let walkRun: RouteStep[] = []

  for (const step of steps) {
    if (isMergeableWalkStep(step)) {
      walkRun.push(step)
      continue
    }
    if (walkRun.length) {
      merged.push(mergeWalkingRun(walkRun))
      walkRun = []
    }
    merged.push(step)
  }

  if (walkRun.length) merged.push(mergeWalkingRun(walkRun))
  return merged
}

export default function RouteDetailsPanel({
  selection,
  onClose,
}: {
  selection: PlannerRouteDetailsSelection
  onClose: () => void
}) {
  const { segment, profile } = selection
  const steps = mergeConsecutiveWalkingSteps(segment.steps ?? [])
  const tollText = segment.tollText?.trim()

  return (
    <aside
      aria-label="Route details"
      className="bg-surface-card text-content"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'var(--font-system)',
      }}
    >
      <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid var(--border-faint)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="text-content-faint" style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0 }}>
            {selection.dayTitle || 'Route'}
          </div>
          <h3 style={{ margin: '3px 0 0', fontSize: 14, lineHeight: 1.25, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {selection.title}
          </h3>
          {selection.subtitle && (
            <div className="text-content-faint" style={{ marginTop: 3, fontSize: 11.5, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {selection.subtitle}
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="Close route details"
          onClick={onClose}
          className="bg-transparent text-content-faint"
          style={{
            width: 28,
            height: 28,
            border: 'none',
            borderRadius: 7,
            display: 'grid',
            placeItems: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>

      <div style={{ padding: 14, display: 'grid', gap: 12, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: tollText ? '1fr 1fr 1fr' : '1fr 1fr', gap: 8 }}>
          <div className="bg-surface-hover" style={{ borderRadius: 8, padding: '8px 9px' }}>
            <div className="text-content-faint" style={{ fontSize: 10, fontWeight: 600 }}>Time</div>
            <div style={{ marginTop: 3, fontSize: 13, fontWeight: 700 }}>{durationText(segment, profile)}</div>
          </div>
          <div className="bg-surface-hover" style={{ borderRadius: 8, padding: '8px 9px' }}>
            <div className="text-content-faint" style={{ fontSize: 10, fontWeight: 600 }}>Distance</div>
            <div style={{ marginTop: 3, fontSize: 13, fontWeight: 700 }}>{segment.distanceText}</div>
          </div>
          {tollText && (
            <div className="bg-surface-hover" style={{ borderRadius: 8, padding: '8px 9px' }}>
              <div className="text-content-faint" style={{ fontSize: 10, fontWeight: 600 }}>Toll</div>
              <div style={{ marginTop: 3, fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Coins size={12} strokeWidth={2} />
                {tollText}
              </div>
            </div>
          )}
        </div>

        <div className="bg-surface-hover" style={{ borderRadius: 8, padding: '10px 10px 9px', display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 7, alignItems: 'center' }}>
            <MapPin size={14} strokeWidth={2} className="text-content-faint" />
            <div style={{ minWidth: 0, fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selection.fromLabel}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 7, alignItems: 'center' }}>
            <MapPin size={14} strokeWidth={2} className="text-content-faint" />
            <div style={{ minWidth: 0, fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selection.toLabel}
            </div>
          </div>
        </div>

        <div>
          <div className="text-content-faint" style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0, marginBottom: 8 }}>
            Steps
          </div>
          {steps.length === 0 ? (
            <div className="text-content-faint bg-surface-hover" style={{ borderRadius: 8, padding: 12, fontSize: 12, lineHeight: 1.35 }}>
              Step details are not available for this route.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {steps.map((step, index) => {
                const isTransit = step.mode === 'transit' && step.transit
                const Icon = modeIcon(step.mode, profile)
                const color = isTransit ? safeColor(step.transit?.line.color) : undefined
                const textColor = isTransit ? safeColor(step.transit?.line.textColor) || '#fff' : undefined
                const stops = stopText(step)
                const meta = stepMeta(step)
                return (
                  <div
                    key={`${step.mode}-${index}-${lineLabel(step)}`}
                    className="bg-surface-hover"
                    style={{
                      borderRadius: 8,
                      padding: '9px 10px',
                      display: 'grid',
                      gridTemplateColumns: '24px minmax(0, 1fr)',
                      gap: 9,
                      borderLeft: isTransit && color ? `4px solid ${color}` : '4px solid var(--border-primary)',
                    }}
                  >
                    <div style={{
                      width: 24,
                      height: 24,
                      borderRadius: 7,
                      display: 'grid',
                      placeItems: 'center',
                      background: isTransit && color ? color : 'var(--bg-card)',
                      color: isTransit && color ? textColor : 'var(--text-muted)',
                    }}>
                      <Icon size={14} strokeWidth={2} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      {isTransit ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            maxWidth: '100%',
                            minWidth: 0,
                            padding: '2px 7px',
                            borderRadius: 5,
                            background: color || 'var(--accent)',
                            color: textColor || 'var(--accent-text)',
                            fontSize: 11,
                            fontWeight: 800,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {lineLabel(step)}
                          </span>
                          {step.transit?.line.headsign && (
                            <span className="text-content-faint" style={{ minWidth: 0, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {step.transit.line.headsign}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div style={{ fontSize: 12.5, fontWeight: 650, lineHeight: 1.3 }}>
                          {step.instruction || (step.mode === 'walking' ? 'Walk' : 'Continue')}
                        </div>
                      )}
                      {stops && (
                        <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.35 }}>
                          {stops}
                        </div>
                      )}
                      <div className="text-content-faint" style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, minHeight: 14 }}>
                        {meta && (
                          <>
                            <Clock size={11} strokeWidth={2} />
                            <span>{meta}</span>
                          </>
                        )}
                        {isTransit && Number.isFinite(step.transit?.stopCount) && (
                          <span>{`${meta ? '· ' : ''}${step.transit?.stopCount} stops`}</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
