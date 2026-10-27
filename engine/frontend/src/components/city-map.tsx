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
    // Most city labels sit to the right of their circle (the eastmost one points left, inward):
    // keep up to a quarter of the width free for them.
    const labelRoom = labels ? Math.min(110, Math.round(size.x / 4)) : 32
    map.fitBounds(latLngBounds(spots), {
      paddingTopLeft: [32, 32],
      paddingBottomRight: [labelRoom, 32],
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
  const eastmost = cities.length > 1 ? Math.max(...cities.map((city) => city.lng)) : null
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
          // Half steps, so the fit to the cities is close at any width (tiles stay sharp enough).
          zoomSnap={0.5}
          scrollWheelZoom
          className="size-full"
        >
          <TileLayer
            url={TILES}
            attribution={CREDIT}
            maxZoom={18}
            referrerPolicy={TILE_REFERRER_POLICY}
          />
          {fitToPoints && points.length > 0 ? (
            <FitView
              spots={points.map((point) => [point.lat, point.lng])}
              labels={false}
              maxZoom={12}
            />
          ) : (
            <FitView spots={cities.map((city) => [city.lat, city.lng])} labels maxZoom={6} />
          )}
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
                <Tooltip
                  permanent
                  // The eastmost city's label points inward, so it never runs off the map.
                  direction={city.lng === eastmost ? 'left' : 'right'}
                  offset={city.lng === eastmost ? [-14, 0] : [14, 0]}
                >
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
