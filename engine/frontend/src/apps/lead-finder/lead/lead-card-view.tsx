/**
 * One lead's card (PLAN-V6, F2). The lead page shows it, and the Results page shows the same card
 * in its side panel (`compact`).
 *
 * - At the top, the quick view (card/quick-view.tsx): what a person needs to decide, and the
 *   actions, without scrolling on a laptop.
 * - Under it, the details in tabs, one file each in card/: Overview, Facts, Signs, Score and rules,
 *   HubSpot and look-alikes, Research. The arrow keys move between the tabs. The tab stays when the
 *   side panel moves to another lead, so a person can compare the same tab across leads.
 *
 * Every text came from a web page or from Claude, so all of it is rendered as plain text, and every
 * link goes through `SourceLink` (http and https only, opens in a new tab, shows the host).
 */
import { useState, type ComponentType } from 'react'
import type { LeadDetail } from '@/api/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { QuickView } from './card/quick-view'
import { FactsTab } from './card/tab-facts'
import { HubSpotTab } from './card/tab-hubspot'
import { OverviewTab } from './card/tab-overview'
import { ResearchTab } from './card/tab-research'
import { ScoreTab } from './card/tab-score'
import { SignsTab } from './card/tab-signs'

interface CardTab {
  id: string
  label: string
  Body: ComponentType<{ lead: LeadDetail }>
  /** Two sections that sit side by side on a wide page. */
  pair: boolean
}

const TABS: readonly CardTab[] = [
  { id: 'overview', label: 'Overview', Body: OverviewTab, pair: true },
  { id: 'facts', label: 'Facts', Body: FactsTab, pair: false },
  { id: 'signs', label: 'Signs', Body: SignsTab, pair: false },
  { id: 'score', label: 'Score and rules', Body: ScoreTab, pair: true },
  { id: 'hubspot', label: 'HubSpot and look-alikes', Body: HubSpotTab, pair: true },
  { id: 'research', label: 'Research', Body: ResearchTab, pair: true },
]

export interface LeadCardViewProps {
  lead: LeadDetail
  /** For the side panel: no title (the panel has one), and each tab in one column. */
  compact?: boolean
}

export function LeadCardView({ lead, compact = false }: LeadCardViewProps) {
  const [tab, setTab] = useState(TABS[0]?.id ?? 'overview')
  return (
    <div className="flex flex-col gap-6">
      <QuickView lead={lead} />
      <Tabs value={tab} onValueChange={setTab}>
        {/* One row that scrolls sideways when the screen is too narrow, never two rows. */}
        <TabsList
          aria-label="Lead details"
          className="w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] touch:h-11 [&::-webkit-scrollbar]:hidden"
        >
          {TABS.map((item) => (
            <TabsTrigger
              key={item.id}
              value={item.id}
              className="flex-none group-data-horizontal/tabs:after:bottom-0"
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map(({ id, Body, pair }) => (
          <TabsContent key={id} value={id} className="mt-2 min-w-0">
            {/* grid-cols-1 keeps a wide table inside its card, where it scrolls on its own. */}
            <div className={cn('grid grid-cols-1 gap-6', pair && !compact && 'xl:grid-cols-2')}>
              <Body lead={lead} />
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
