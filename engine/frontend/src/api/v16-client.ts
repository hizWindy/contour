/**
 * The API client for the routes PLAN-V16 adds, typed by hand (`V16Paths` in v16.ts) until M1
 * makes them part of `schema.d.ts`. It is the same client as `api`, with the same time limits and
 * errors: only its type differs. At M1 the hooks call `api` again and this file goes.
 */
import type { Client } from 'openapi-fetch'
import { api } from './client'
import type { V16Paths } from './v16'

export const apiV16 = api as unknown as Client<V16Paths>
