import { PageStub } from '@/shell/page-stub'

/** A placeholder: this page is built in a later step. */
export default function AdminSearchesTab() {
  return (
    <PageStub
      title="Search log"
      purpose="Every Claude request: what it searched, the pages it read and what it cost."
      withHeader={false}
    />
  )
}
