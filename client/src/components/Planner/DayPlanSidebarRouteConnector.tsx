import { AlertTriangle, Car, Coins, Footprints, Hotel, Ticket, Train } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { RouteSegment } from '../../types'

type PlannerRouteProfile = 'driving' | 'walking' | 'transit'

function routeProfileIcon(profile: PlannerRouteProfile) {
  if (profile === 'driving') return Car
  if (profile === 'transit') return Train
  return Footprints
}

function routeDurationText(seg: RouteSegment, profile: PlannerRouteProfile): string {
  return seg.durationText ?? (profile === 'walking' ? seg.walkingText : seg.drivingText)
}

/** Slim travel-time connector shown between two consecutive located stops in a day. */
export function RouteConnector({
  seg,
  profile,
  selected = false,
  onClick,
  ariaLabel = 'Show route details',
}: {
  seg: RouteSegment
  profile: PlannerRouteProfile
  selected?: boolean
  onClick?: () => void
  ariaLabel?: string
}) {
  const Icon = routeProfileIcon(profile)
  const isError = Boolean(seg.errorText)
  const line = { flex: 1, height: 1, minHeight: 1, alignSelf: 'center', background: isError ? 'rgba(220,38,38,0.35)' : 'var(--border-primary)' }
  const tollText = seg.tollText?.trim()
  const fareText = seg.fareText?.trim()
  const content = (
    <>
      <div style={line} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {isError ? (
          <>
            <AlertTriangle size={11} strokeWidth={2} />
            <span>{seg.errorText}</span>
          </>
        ) : (
          <>
            <Icon size={11} strokeWidth={2} />
            <span>{routeDurationText(seg, profile)}</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>{seg.distanceText}</span>
          </>
        )}
        {tollText && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <Coins size={11} strokeWidth={2} />
            <span>{tollText}</span>
          </>
        )}
        {fareText && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <Ticket size={11} strokeWidth={2} />
            <span>{fareText}</span>
          </>
        )}
      </div>
      <div style={line} />
    </>
  )
  const style: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '3px 14px',
    fontSize: 10.5,
    color: isError ? '#dc2626' : selected ? 'var(--accent)' : 'var(--text-faint)',
    lineHeight: 1.2,
    width: '100%',
    background: selected ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
  }
  if (!onClick || isError) {
    return <div style={style}>{content}</div>
  }
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      style={{
        ...style,
        appearance: 'none',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {content}
    </button>
  )
}

/**
 * The hotel's bookend legs for a day: a two-line connector naming the day's
 * accommodation with the drive to/from it. Rendered above the first place (the
 * morning departure from the hotel) and below the last place (the evening return),
 * when the "optimize from accommodation" setting is on and the day has a hotel.
 */
export function HotelRouteConnector({
  seg,
  profile,
  name,
  placement,
  selected = false,
  onClick,
  ariaLabel = 'Show route details',
}: {
  seg: RouteSegment
  profile: PlannerRouteProfile
  name: string
  placement: 'top' | 'bottom'
  selected?: boolean
  onClick?: () => void
  ariaLabel?: string
}) {
  const Icon = routeProfileIcon(profile)
  const isError = Boolean(seg.errorText)
  const line = { flex: 1, height: 1, minHeight: 1, alignSelf: 'center', background: isError ? 'rgba(220,38,38,0.35)' : 'var(--border-primary)' }
  const tollText = seg.tollText?.trim()
  const fareText = seg.fareText?.trim()
  const hotelRow = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '0 14px', minWidth: 0 }}>
      <Hotel size={12} strokeWidth={1.8} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
      <span style={{ fontSize: 'calc(11px * var(--fs-scale-caption, 1))', fontWeight: 600, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
        {name}
      </span>
    </div>
  )
  const travelRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 14px', fontSize: 'calc(10.5px * var(--fs-scale-caption, 1))', color: isError ? '#dc2626' : 'var(--text-faint)', lineHeight: 1.2 }}>
      <div style={line} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {isError ? (
          <>
            <AlertTriangle size={11} strokeWidth={2} />
            <span>{seg.errorText}</span>
          </>
        ) : (
          <>
            <Icon size={11} strokeWidth={2} />
            <span>{routeDurationText(seg, profile)}</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>{seg.distanceText}</span>
          </>
        )}
        {tollText && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <Coins size={11} strokeWidth={2} />
            <span>{tollText}</span>
          </>
        )}
        {fareText && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <Ticket size={11} strokeWidth={2} />
            <span>{fareText}</span>
          </>
        )}
      </div>
      <div style={line} />
    </div>
  )
  const content = (
    <>
      {placement === 'top' ? (
        <>
          {hotelRow}
          {travelRow}
        </>
      ) : (
        <>
          {travelRow}
          {hotelRow}
        </>
      )}
    </>
  )
  const style: CSSProperties = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 3,
    padding: placement === 'top' ? '2px 0 6px' : '6px 0 2px',
    width: '100%',
    color: selected ? 'var(--accent)' : undefined,
    background: selected ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
  }
  if (!onClick || isError) {
    return <div style={style}>{content}</div>
  }
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      style={{
        ...style,
        appearance: 'none',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {content}
    </button>
  )
}
