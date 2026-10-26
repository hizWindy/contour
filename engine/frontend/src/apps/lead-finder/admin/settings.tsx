import { PageStub } from '@/shell/page-stub'

/** A placeholder: this page is built in a later step. */
export default function AdminSettingsTab() {
  return (
    <PageStub
      title="Settings"
      purpose="Caps, models and limits, with the values from engine/.env shown read-only."
      withHeader={false}
    />
  )
}
