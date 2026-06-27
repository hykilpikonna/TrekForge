import { fireEvent, render, screen } from '../../../tests/helpers/render'
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
          dayId: 10,
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

  it('combines adjacent walking steps into one displayed segment', () => {
    render(
      <RouteDetailsPanel
        selection={{
          key: 'route-2',
          dayId: 10,
          profile: 'transit',
          title: 'Museum to Lunch',
          subtitle: 'Museum to Lunch',
          fromLabel: 'Museum',
          toLabel: 'Lunch',
          dayTitle: 'Day 1',
          segment: {
            ...transitSegment,
            steps: [
              {
                mode: 'walking',
                instruction: 'Walk north',
                distance: 100,
                duration: 60,
                distanceText: '100 m',
                durationText: '1 min',
              },
              {
                mode: 'walking',
                instruction: 'Turn left',
                distance: 250,
                duration: 240,
                distanceText: '250 m',
                durationText: '4 min',
              },
              transitSegment.steps![1],
              {
                mode: 'walking',
                instruction: 'Walk to Lunch',
                distance: 80,
                duration: 90,
                distanceText: '80 m',
                durationText: '2 min',
              },
            ],
          },
        }}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('5 min · 350 m')).toBeInTheDocument()
    expect(screen.queryByText('Walk north')).not.toBeInTheDocument()
    expect(screen.queryByText('Turn left')).not.toBeInTheDocument()
    expect(screen.getByText('Walk to Lunch')).toBeInTheDocument()
  })

  it('renders route alternatives and forwards the selected index', () => {
    const onAlternativeSelect = vi.fn()
    const longLineName = 'Elizabeth line to Heathrow Terminal 5'
    render(
      <RouteDetailsPanel
        selection={{
          key: 'route-3',
          dayId: 10,
          profile: 'transit',
          title: 'Museum to Lunch',
          subtitle: 'Museum to Lunch',
          fromLabel: 'Museum',
          toLabel: 'Lunch',
          dayTitle: 'Day 1',
          segment: {
            ...transitSegment,
            duration: 780,
            walkingText: '5 min',
            drivingText: '13 min',
            distanceText: '2.1 km',
            durationText: '13 min',
            fareText: 'EUR 2.80',
            routeAlternativeIndex: 1,
            alternatives: [
              {
                index: 0,
                distance: 2300,
                duration: 960,
                walkingText: '4 min',
                drivingText: '16 min',
                distanceText: '2.3 km',
                durationText: '16 min',
                fareText: 'EUR 2.10',
                steps: [
                  { mode: 'walking', duration: 240, durationText: '4 min', distanceText: '300 m' },
                  {
                    mode: 'transit',
                    transit: {
                      line: { name: 'Bus 42', vehicleType: 'Bus', color: '#16a34a' },
                    },
                  },
                ],
              },
              {
                index: 1,
                distance: 2100,
                duration: 780,
                walkingText: '5 min',
                drivingText: '13 min',
                distanceText: '2.1 km',
                durationText: '13 min',
                fareText: 'EUR 2.80',
                steps: [
                  { mode: 'walking', duration: 180, durationText: '3 min', distanceText: '200 m' },
                  {
                    mode: 'transit',
                    transit: {
                      line: { name: longLineName, vehicleType: 'Train', color: '#7c3aed' },
                    },
                  },
                  { mode: 'walking', duration: 120, durationText: '2 min', distanceText: '120 m' },
                ],
              },
            ],
          },
          onAlternativeSelect,
        }}
        onClose={vi.fn()}
      />
    )

    expect(screen.queryByText('Route 1')).not.toBeInTheDocument()
    expect(screen.getByText('Bus 42')).toBeInTheDocument()
    expect(screen.getByText(longLineName)).toHaveStyle({ whiteSpace: 'normal' })
    expect(screen.getByText('Total 13 min')).toBeInTheDocument()
    expect(screen.queryByText('Walk 5 min')).not.toBeInTheDocument()
    expect(screen.getAllByText('5 min').length).toBeGreaterThan(0)
    expect(screen.getAllByText('EUR 2.80').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByLabelText(/Select Walk to Bus 42/))
    expect(onAlternativeSelect).toHaveBeenCalledWith(0)
  })

  it('renders driving alternative toll text in the route chooser', () => {
    render(
      <RouteDetailsPanel
        selection={{
          key: 'route-4',
          dayId: 10,
          profile: 'driving',
          title: 'Castle to Hotel',
          subtitle: 'Castle to Hotel',
          fromLabel: 'Castle',
          toLabel: 'Hotel',
          segment: {
            mid: [35.38, 136.94],
            from: [35.38, 136.94],
            to: [35.41, 136.76],
            distance: 45000,
            duration: 3600,
            walkingText: '9 h',
            drivingText: '1 h',
            durationText: '1 h',
            distanceText: '45 km',
            tollText: 'ETC \u00a58620',
            alternatives: [
              {
                index: 0,
                distance: 45000,
                duration: 3600,
                walkingText: '9 h',
                drivingText: '1 h',
                durationText: '1 h',
                distanceText: '45 km',
                tollText: 'ETC \u00a58620',
              },
              {
                index: 1,
                distance: 52000,
                duration: 4200,
                walkingText: '10 h',
                drivingText: '1 h 10 min',
                durationText: '1 h 10 min',
                distanceText: '52 km',
                tollText: 'ETC \u00a54100',
              },
            ],
          },
        }}
        onClose={vi.fn()}
      />
    )

    expect(screen.getAllByText('ETC \u00a58620').length).toBeGreaterThan(0)
    expect(screen.getByText('ETC \u00a54100')).toBeInTheDocument()
  })

})
