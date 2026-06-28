import { render, screen } from '../../../tests/helpers/render'
import type { RouteSegment } from '../../types'
import { HotelRouteConnector, RouteConnector } from './DayPlanSidebarRouteConnector'

const segment: RouteSegment = {
  mid: [35.5, 139.5],
  from: [35.6, 139.7],
  to: [35.3, 139.2],
  distance: 1200,
  duration: 1050,
  walkingText: '18 min',
  drivingText: '18 min',
  distanceText: '1.2 km',
  durationText: '18 min',
  tollText: 'ETC \u00a58620',
}

describe('DayPlanSidebarRouteConnector', () => {
  it('renders toll text for route connectors', () => {
    render(<RouteConnector seg={segment} profile="driving" />)

    expect(screen.getByText('18 min')).toBeInTheDocument()
    expect(screen.getByText('1.2 km')).toBeInTheDocument()
    expect(screen.getByText('ETC \u00a58620')).toBeInTheDocument()
  })

  it('renders fare text for route connectors', () => {
    render(<RouteConnector seg={{ ...segment, tollText: undefined, fareText: 'Free' }} profile="transit" />)

    expect(screen.getByText('Free')).toBeInTheDocument()
  })

  it('renders route errors without duration or distance text', () => {
    render(<RouteConnector seg={{ ...segment, errorText: 'Failed to calculate route', distanceText: '', durationText: '' }} profile="driving" onClick={vi.fn()} />)

    expect(screen.getByText('Failed to calculate route')).toBeInTheDocument()
    expect(screen.queryByText('1.2 km')).not.toBeInTheDocument()
  })

  it('renders toll text for hotel route connectors', () => {
    render(<HotelRouteConnector seg={segment} profile="driving" name="Tokyo Hotel" placement="top" />)

    expect(screen.getByText('Tokyo Hotel')).toBeInTheDocument()
    expect(screen.getByText('ETC \u00a58620')).toBeInTheDocument()
  })

  it('renders route errors for hotel route connectors', () => {
    render(<HotelRouteConnector seg={{ ...segment, errorText: 'Failed to calculate route', distanceText: '', durationText: '' }} profile="driving" name="Tokyo Hotel" placement="bottom" onClick={vi.fn()} />)

    expect(screen.getByText('Tokyo Hotel')).toBeInTheDocument()
    expect(screen.getByText('Failed to calculate route')).toBeInTheDocument()
  })
})
