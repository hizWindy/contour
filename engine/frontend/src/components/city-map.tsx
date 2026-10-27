/**
 * The map: OpenStreetMap tiles through React-Leaflet, with the cities a run can search and the
 * leads as pins coloured by result.
 *
 * Safety: every label is a React child inside <Tooltip>, which React escapes. Nothing here hands
 * Leaflet an HTML string (no divIcon html, no bindPopup or bindTooltip; the lint enforces it).
 *
 * Colour is never the only signal: each pin's tooltip says its result in words, the legend has an
 * icon and a word per result, and the city buttons under the map say which cities are picked. The
 * buttons are also the keyboard way to pick a city, since a map pin can't take focus.
 */
import { latLngBounds } from 'leaflet'
import { useEffect, useEffectEvent } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { CityOption, MapPoint } from '@/api/types'
import { ResultBadge } from '@/components/result-badge'
import { Toggle } from '@/components/ui/toggle'
import { RESULT_LABELS, RESULT_ORDER } from '@/lib/labels'
import { cn } from '@/lib/utils'

/** The middle of Australia's mainland, close enough to show Perth and Sydney at once. */
const AUSTRALIA: [number, number] = [-29.5, 134]
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
// Plain text on purpose: Leaflet writes the credit as HTML, so it holds no markup.
const CREDIT = '© OpenStreetMap contributors'

export interface CityMapProps {
  /** What the map shows, for screen readers: "Cities to search". */
  label: string
  cities?: readonly CityOption[]
  /** The names of the picked cities. */
  selectedCities?: readonly string[]
  /** Picks or unpicks a city (a click on its circle, or its button under the map). */
  onToggleCity?: (name: string) => void
  points?: readonly MapPoint[]
  activePointId?: string | null
  onSelectPoint?: (id: string) => void
  /** Says under the map that pins are approximate (they are: a suburb's or a city's centre). */
  approximate?: boolean
  /** Zooms to the pins whenever they change, so a filter for one city shows that city. */
  fitToPoints?: boolean
  center?: [number, number]
  zoom?: number
  className?: string
}

/** Inside the map: zooms to the pins when the set of pins changes (not when one is picked). */
function FitToPoints({ points }: { points: readonly MapPoint[] }) {
  const map = useMap()
  const pins = points.map((point) => point.id).join(',')
  const fit = useEffectEvent(() => {
    // A map that has no size yet (a hidden tab, a test page) can't work out a zoom.
    if (points.length === 0 || map.getSize().x === 0) {
      return
    }
    const bounds = latLngBounds(points.map((point) => [point.lat, point.lng] as [number, number]))
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 12 })
  })
  useEffect(() => {
    fit()
  }, [pins])
  return null
}

/** Leaflet only notices the window changing size. A dragged divider resizes just the map, so tell it. */
function TrackSize() {
  const map = useMap()
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      map.invalidateSize()
    })
    observer.observe(map.getContainer())
    return () => {
      observer.disconnect()
    }
  }, [map])
  return null
}

function cityWords(city: CityOption): string {
  return city.kind === 'director_review' ? `${city.name}, Director review` : city.name
}

export function CityMap({
  label,
  cities = [],
  selectedCities = [],
  onToggleCity,
  points = [],
  activePointId = null,
  onSelectPoint,
  approximate = false,
  fitToPoints = false,
  center = AUSTRALIA,
  zoom = 4,
  className,
}: CityMapProps) {
  const picked = new Set(selectedCities)
  return (
    <figure data-slot="city-map" className={cn('flex flex-col gap-3', className)}>
      <div
        role="region"
        aria-label={label}
        className="relative h-[28rem] overflow-hidden rounded-lg border bg-muted"
      >
        <MapContainer center={center} zoom={zoom} scrollWheelZoom className="size-full">
          <TileLayer url={TILES} attribution={CREDIT} maxZoom={18} />
          <TrackSize />
          {fitToPoints ? <FitToPoints points={points} /> : null}
          {cities.map((city) => {
            const selected = picked.has(city.name)
            return (
              <CircleMarker
                // Leaflet sets a path's class only when it is made, so a change makes a new one.
                key={`city-${city.name}-${selected ? 'on' : 'off'}`}
                center={[city.lat, city.lng]}
                radius={14}
                // A top-level option, not in pathOptions: React-Leaflet applies pathOptions with
                // setStyle after the path is made, and setStyle ignores a class.
                className={cn(
                  'city-map-city',
                  city.kind === 'director_review' && 'city-map-city-review',
                  selected && 'city-map-city-selected',
                )}
                eventHandlers={
                  onToggleCity
                    ? {
                        click: () => {
                          onToggleCity(city.name)
                        },
                      }
                    : undefined
                }
              >
                <Tooltip permanent direction="right" offset={[14, 0]}>
                  {cityWords(city)}
                </Tooltip>
              </CircleMarker>
            )
          })}
          {points.map((point) => {
            const active = point.id === activePointId
            return (
              <CircleMarker
                key={`pin-${point.id}-${active ? 'on' : 'off'}`}
                center={[point.lat, point.lng]}
                radius={active ? 8 : 6}
                className={cn(
                  'city-map-pin',
                  `city-map-pin-${point.result}`,
                  active && 'city-map-pin-active',
                )}
                eventHandlers={
                  onSelectPoint
                    ? {
                        click: () => {
                          onSelectPoint(point.id)
                        },
                      }
                    : undefined
                }
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  <span className="font-semibold">{point.name}</span>
                  <br />
                  {RESULT_LABELS[point.result]}, score {point.score}
                </Tooltip>
              </CircleMarker>
            )
          })}
        </MapContainer>
      </div>
      {cities.length > 0 && onToggleCity ? (
        <div role="group" aria-label="Cities" className="flex flex-wrap gap-2">
          {cities.map((city) => (
            <Toggle
              key={city.name}
              variant="outline"
              size="sm"
              pressed={picked.has(city.name)}
              onPressedChange={() => {
                onToggleCity(city.name)
              }}
            >
              {cityWords(city)}
            </Toggle>
          ))}
        </div>
      ) : null}
      {points.length > 0 ? (
        <>
          <ul aria-label="Legend" className="flex flex-wrap gap-2">
            {RESULT_ORDER.map((result) => (
              <li key={result}>
                <ResultBadge result={result} />
              </li>
            ))}
          </ul>
          {/* The same pins as text, for screen readers. */}
          <ul className="sr-only" aria-label="Leads on the map">
            {points.map((point) => (
              <li key={point.id}>
                {point.name}: {RESULT_LABELS[point.result]}, score {point.score}
                {(point.suburb ?? point.city) ? `, near ${point.suburb ?? point.city}` : ''}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {approximate ? (
        <figcaption className="text-caption text-muted-foreground">
          Pins are approximate: each one sits at its suburb or city centre, moved a little so they
          don&apos;t overlap.
        </figcaption>
      ) : null}
    </figure>
  )
}
