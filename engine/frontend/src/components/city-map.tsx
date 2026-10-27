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
import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import type { CityOption, MapPoint } from '@/api/types'
import { ResultBadge } from '@/components/result-badge'
import { Toggle } from '@/components/ui/toggle'
import { RESULT_LABELS, RESULT_ORDER } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { labelDirection, labelOffset, labelWidth, placeLabels, type Side } from './city-labels'

/** The middle of Australia's mainland, close enough to show Perth and Sydney at once. */
const AUSTRALIA: [number, number] = [-29.5, 134]
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
// Plain text on purpose: Leaflet writes the credit as HTML, so it holds no markup.
const CREDIT = '© OpenStreetMap contributors'
/*
  OpenStreetMap's tile servers block a website that sends no Referer (its tile usage policy), and
  show an "Access blocked" tile instead. The site's own Referrer-Policy (same-origin) sends none to
  other sites, so the tiles ask for the origin only: "http://localhost:5173/", never the page's
  path, so no lead id or filter leaves the site.
*/
const TILE_REFERRER_POLICY = 'strict-origin-when-cross-origin'

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
  /**
   * Zooms to the pins whenever they change, so a filter for one city shows that city. Without
   * it (or with no pins), the map fits the cities.
   */
  fitToPoints?: boolean
  center?: [number, number]
  zoom?: number
  className?: string
}

type Spot = [number, number]

/**
 * Inside the map: shows every spot (the pins, or the cities when there are none), with room for
 * the labels that sit to the right of each city. It fits again when the spots change (not when
 * one is picked) and when the map's box changes size: a narrower window, a dragged divider. So
 * the cities are never cut off at the edge, at any width.
 */
function FitView({ spots, labels, maxZoom }: { spots: Spot[]; labels: boolean; maxZoom: number }) {
  const map = useMap()
  const key = spots.map(([lat, lng]) => `${lat.toFixed(4)},${lng.toFixed(4)}`).join(';')
  const fit = useEffectEvent(() => {
    const size = map.getSize()
    // A map that has no size yet (a hidden tab, a test page) can't work out a zoom.
    if (spots.length === 0 || size.x === 0) {
      return
    }
    // City names find a free side of their circle (see `placeLabels`), so the circles may use
    // nearly the whole width: the room kept is for the circle itself and a little air.
    const edge = labels ? 28 : 32
    map.fitBounds(latLngBounds(spots), {
      paddingTopLeft: [edge, edge],
      paddingBottomRight: [edge, edge],
      maxZoom,
      // No sliding: the map opens already in place, and a resize doesn't make it drift.
      animate: false,
    })
  })
  useEffect(() => {
    fit()
  }, [key])
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      map.invalidateSize()
      fit()
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

/** A map narrower than this (a phone) writes "Sydney (review)", so the names take less room. */
const NARROW_MAP_PX = 420

/** The name on the map. The buttons under the map always have the full words. */
function mapWords(city: CityOption, narrow: boolean): string {
  return narrow && city.kind === 'director_review' ? `${city.name} (review)` : cityWords(city)
}

interface CityLayerProps {
  cities: readonly CityOption[]
  picked: ReadonlySet<string>
  onToggleCity?: (name: string) => void
}

/**
 * The cities as circles with their names. Each name goes on the side of its circle that is free,
 * worked out from where the circles are on the screen (so it follows the zoom, a resize and a
 * different width). Before the map has a size (a test page), names go right, and the eastmost one
 * goes left, so it stays inside.
 */
function CityLayer({ cities, picked, onToggleCity }: CityLayerProps) {
  const map = useMap()
  // The layout is worked out while drawing, from where the circles are on the screen now. The map
  // tells this part to draw again when it moves, zooms or changes size. (This part comes before
  // `FitView` in the map, so it is listening when the first fit happens.)
  const [, setView] = useState(0)
  const redraw = useCallback(() => {
    setView((count) => count + 1)
  }, [])
  useMapEvents({ moveend: redraw, zoomend: redraw, resize: redraw })

  const eastmost = cities.length > 1 ? Math.max(...cities.map((city) => city.lng)) : null
  const size = map.getSize()
  const narrow = size.x > 0 && size.x < NARROW_MAP_PX
  const sides: Record<string, Side> =
    size.x === 0
      ? {}
      : placeLabels(
          cities.map((city) => {
            const point = map.latLngToContainerPoint([city.lat, city.lng])
            return {
              id: city.name,
              x: point.x,
              y: point.y,
              width: labelWidth(mapWords(city, narrow)),
            }
          }),
          { x: size.x, y: size.y },
        )

  return cities.map((city) => {
    const selected = picked.has(city.name)
    const side: Side = sides[city.name] ?? (city.lng === eastmost ? 'left' : 'right')
    return (
      <CircleMarker
        // Leaflet sets a path's class only when it is made, so a change makes a new one. A new
        // side or wording does the same for the name.
        key={`city-${city.name}-${selected ? 'on' : 'off'}-${side}-${narrow ? 'short' : 'long'}`}
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
        <Tooltip permanent direction={labelDirection(side)} offset={labelOffset(side)}>
          {mapWords(city, narrow)}
        </Tooltip>
      </CircleMarker>
    )
  })
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
        // `isolate` keeps Leaflet's own layers (z-index up to 1000) inside the map, so a side
        // panel, a dialog or a menu always opens above the map, never under it.
        className="relative isolate h-80 overflow-hidden rounded-lg border bg-muted sm:h-[28rem]"
      >
        <MapContainer
          center={center}
          zoom={zoom}
          // Quarter steps, so the fit to the cities is close at any width (the tiles stay sharp
          // enough at a fraction of a zoom).
          zoomSnap={0.25}
          scrollWheelZoom
          className="size-full"
        >
          <TileLayer
            url={TILES}
            attribution={CREDIT}
            maxZoom={18}
            referrerPolicy={TILE_REFERRER_POLICY}
          />
          <CityLayer cities={cities} picked={picked} onToggleCity={onToggleCity} />
          {fitToPoints && points.length > 0 ? (
            <FitView
              spots={points.map((point) => [point.lat, point.lng])}
              labels={false}
              maxZoom={12}
            />
          ) : (
            <FitView spots={cities.map((city) => [city.lat, city.lng])} labels maxZoom={6} />
          )}
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
