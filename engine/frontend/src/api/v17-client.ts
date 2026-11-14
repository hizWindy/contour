/**
 * The API client for the routes PLAN-V17 adds, typed by hand (`V17Paths` in v17.ts) until M1
 * makes them part of `schema.d.ts`. It is the same client as `api`, with the same time limits and
 * errors: only its type differs. At M1 the hooks call `api` again and this file goes.
 */
import type { Client } from 'openapi-fetch'
import { api } from './client'
import type { V17Paths } from './v17'

export const apiV17 = api as unknown as Client<V17Paths>
