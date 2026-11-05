/**
 * What the runs list asks for first. The page and the early request (prefetch.ts) both read it, so
 * they ask for the same thing and share one request.
 */
export const RUNS_PAGE_SIZE = 50

/** The first page of the list: the newest runs. */
export const FIRST_RUNS_PAGE = { limit: RUNS_PAGE_SIZE, offset: 0 } as const
