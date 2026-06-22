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

  it('renders toll text for hotel route connectors', () => {
    render(<HotelRouteConnector seg={segment} profile="driving" name="Tokyo Hotel" placement="top" />)

    expect(screen.getByText('Tokyo Hotel')).toBeInTheDocument()
    expect(screen.getByText('ETC \u00a58620')).toBeInTheDocument()
  })
})
