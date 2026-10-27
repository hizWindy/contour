import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CityOption, MapPoint } from '@/api/types'
import { renderWithProviders } from '@/test/render'
import { CityMap } from './city-map'

const CITIES: CityOption[] = [
  { name: 'Melbourne', kind: 'pass', lat: -37.81, lng: 144.96, areas: [] },
  { name: 'Perth', kind: 'pass', lat: -31.95, lng: 115.86, areas: [] },
  { name: 'Sydney', kind: 'director_review', lat: -33.87, lng: 151.21, areas: [] },
]

const HOSTILE = '<img src=x onerror=alert(1)>'
const POINTS: MapPoint[] = [
  {
    id: 'p1',
    name: 'Acme Software',
    result: 'pass',
    score: 78,
    city: 'Melbourne',
    suburb: 'Cremorne',
    lat: -37.83,
    lng: 144.99,
  },
  {
    id: 'p2',
    name: HOSTILE,
    result: 'drop',
    score: 0,
    city: 'Perth',
    suburb: null,
    lat: -31.95,
    lng: 115.86,
  },
]

function pins(container: HTMLElement): SVGPathElement[] {
  return Array.from(container.querySelectorAll<SVGPathElement>('path.city-map-pin'))
}

describe('CityMap', () => {
  it('shows the cities, says which are Director review, and picks one from its button', async () => {
    const onToggleCity = vi.fn()
    const { user } = renderWithProviders(
      <CityMap
        label="Cities to search"
        cities={CITIES}
        selectedCities={['Melbourne']}
        onToggleCity={onToggleCity}
      />,
    )

    expect(screen.getByRole('region', { name: 'Cities to search' })).toBeInTheDocument()
    const group = screen.getByRole('group', { name: 'Cities' })
    expect(within(group).getByRole('button', { name: 'Melbourne' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const sydney = within(group).getByRole('button', { name: 'Sydney, Director review' })
    expect(sydney).toHaveAttribute('aria-pressed', 'false')
    await user.click(sydney)
    expect(onToggleCity).toHaveBeenCalledWith('Sydney')
  })

  it('draws each city as a circle that can be clicked, marked when picked', () => {
    const onToggleCity = vi.fn()
    const { container } = renderWithProviders(
      <CityMap
        label="Cities"
        cities={CITIES}
        selectedCities={['Perth']}
        onToggleCity={onToggleCity}
      />,
    )
    const circles = container.querySelectorAll<SVGPathElement>('path.city-map-city')
    expect(circles).toHaveLength(3)
    expect(container.querySelectorAll('path.city-map-city-selected')).toHaveLength(1)
    expect(container.querySelectorAll('path.city-map-city-review')).toHaveLength(1)

    fireEvent.click(circles[0])
    expect(onToggleCity).toHaveBeenCalledTimes(1)
  })

  it('names the cities in labels on the map', async () => {
    renderWithProviders(<CityMap label="Cities" cities={CITIES} />)
    // Permanent tooltips: React children, so the names are plain text on the map.
    expect(await screen.findByText('Sydney, Director review')).toBeInTheDocument()
  })

  it('colours each pin by its result and selects a lead from its pin', () => {
    const onSelectPoint = vi.fn()
    const { container } = renderWithProviders(
      <CityMap
        label="Leads"
        points={POINTS}
        activePointId="p1"
        onSelectPoint={onSelectPoint}
        approximate
      />,
    )
    const [first, second] = pins(container)
    expect(first).toHaveClass('city-map-pin-pass', 'city-map-pin-active')
    expect(second).toHaveClass('city-map-pin-drop')
    expect(second).not.toHaveClass('city-map-pin-active')

    fireEvent.click(second)
    expect(onSelectPoint).toHaveBeenCalledWith('p2')
  })

  it('lists the pins as text and shows a legend with words, so colour is not the only sign', () => {
    renderWithProviders(<CityMap label="Leads" points={POINTS} approximate />)
    const list = screen.getByRole('list', { name: 'Leads on the map' })
    expect(
      within(list).getByText('Acme Software: Pass, score 78, near Cremorne'),
    ).toBeInTheDocument()
    const legend = screen.getByRole('list', { name: 'Legend' })
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Pass', 'Director review', 'Watch', 'Drop'])
    expect(screen.getByText(/Pins are approximate/)).toBeInTheDocument()
  })

  it('shows a hostile name as text and never runs it', async () => {
    const { container } = renderWithProviders(<CityMap label="Leads" points={POINTS} />)
    expect(screen.getByText(`${HOSTILE}: Drop, score 0, near Perth`)).toBeInTheDocument()
    const [, second] = pins(container)
    fireEvent.mouseOver(second) // opens the pin's tooltip
    await waitFor(() => {
      expect(container.querySelector('.leaflet-tooltip')).not.toBeNull()
    })
    expect(container.querySelector('[onerror]')).toBeNull()
    expect(container.querySelector('img[src="x"]')).toBeNull()
  })

  it("asks for tiles with the site's origin, which OpenStreetMap needs, and never the page path", async () => {
    const { container } = renderWithProviders(<CityMap label="Map" />)
    await waitFor(() => {
      expect(container.querySelectorAll('img.leaflet-tile').length).toBeGreaterThan(0)
    })
    // Leaflet sets the image's referrerPolicy property (jsdom doesn't mirror it as an attribute).
    for (const tile of container.querySelectorAll<HTMLImageElement>('img.leaflet-tile')) {
      expect(tile.referrerPolicy).toBe('strict-origin-when-cross-origin')
    }
  })

  it('credits OpenStreetMap', () => {
    const { container } = renderWithProviders(<CityMap label="Map" />)
    expect(container.querySelector('.leaflet-control-attribution')).toHaveTextContent(
      'OpenStreetMap contributors',
    )
  })
})
