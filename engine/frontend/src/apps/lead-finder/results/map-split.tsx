/**
 * The list and the map side by side, with a handle between them to drag. A file of its own, because
 * the panel library is needed only in the map view on a wide screen (PLAN-V7 D1).
 */
import type { ReactNode } from 'react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'

export default function MapSplit({ list, map }: { list: ReactNode; map: ReactNode }) {
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-[36rem] rounded-lg border bg-card"
    >
      <ResizablePanel defaultSize="42%" minSize="25%">
        <div className="h-full overflow-auto p-3">{list}</div>
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize the list and the map" />
      <ResizablePanel defaultSize="58%" minSize="30%">
        <div className="h-full p-3">{map}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
