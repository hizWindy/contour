/**
 * How the Results map fits its pins (PLAN-V16 T3-5): all of Australia when the leads are spread
 * over more than one city, and the one city when they aren't. A pin with no city is not counted.
 */
import type { MapPoint } from '@/api/types'

export function spreadOverCities(points: readonly Pick<MapPoint, 'city'>[]): boolean {
  const cities = new Set<string>()
  for (const point of points) {
    if (point.city) cities.add(point.city)
    if (cities.size > 1) return true
  }
  return false
}
