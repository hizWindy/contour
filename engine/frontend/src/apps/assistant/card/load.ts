/**
 * The review card's code, loaded late (PLAN-V22 T3-3): the first time a card opens, or ahead of
 * that while the voice bar works a command out. Never in the first visit.
 */
export const loadCard = () => import('./card')

/** Starts the card's download ahead of its first use. A failed one tries again on the use. */
export function preloadCard(): void {
  void loadCard().catch(() => undefined)
}
