/**
 * The route at each of the Assistant's old addresses (`old-addresses.ts`): it goes on to the new
 * one at once, with the query and hash, and replaces the old address in the history.
 */
import { Navigate, useLocation } from 'react-router'
import { movedTo } from './old-addresses'

export function MovedAddress() {
  const { pathname, search, hash } = useLocation()
  return <Navigate to={movedTo(pathname, search, hash)} replace />
}
