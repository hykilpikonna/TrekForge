import { render, screen } from '../../../tests/helpers/render'
import type { RouteSegment } from '../../types'
import RouteDetailsPanel from './RouteDetailsPanel'

const transitSegment: RouteSegment = {
  mid: [48.86, 2.34],
  from: [48.86, 2.34],
  to: [48.87, 2.35],
  distance: 2300,
  duration: 960,
  walkingText: '16 min',
  drivingText: '16 min',
  distanceText: '2.3 km',
  durationText: '16 min',
  steps: [
    {
      mode: 'walking',
      instruction: 'Walk to Opera',
      distanceText: '300 m',
      durationText: '4 min',
    },
    {
      mode: 'transit',
      distanceText: '2.0 km',
      durationText: '12 min',
      transit: {
        line: {
          name: 'Metro 2',
          shortName: 'M2',
          headsign: 'Nation',
          color: '#2563eb',
        },
        departureStop: { name: 'Opera' },
        arrivalStop: { name: 'Nation' },
        stopCount: 5,
      },
    },
  ],
}

describe('RouteDetailsPanel', () => {
  it('renders transit line, stops, and summary details', () => {
    render(
      <RouteDetailsPanel
        selection={{
          key: 'route-1',
          profile: 'transit',
          title: 'Museum to Lunch',
          subtitle: 'Museum to Lunch',
          fromLabel: 'Museum',
          toLabel: 'Lunch',
          dayTitle: 'Day 1',
          segment: transitSegment,
        }}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('M2')).toBeInTheDocument()
    expect(screen.getByText('Opera to Nation')).toBeInTheDocument()
    expect(screen.getByText(/5 stops/)).toBeInTheDocument()
    expect(screen.getByText('2.3 km')).toBeInTheDocument()
  })
})
