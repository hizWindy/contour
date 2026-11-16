/**
 * The route at Call logs' old address (`old-address.ts`): it goes on to the new one at once, with
 * its tab and `log=1`, and replaces the old address in the history.
 */
import { Navigate, useLocation } from 'react-router'
import { movedTo } from './old-address'

export function OldActivityAddress() {
  const { search, hash } = useLocation()
  return <Navigate to={movedTo(search, hash)} replace />
}
