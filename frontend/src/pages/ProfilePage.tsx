import { PageHeader } from '../components/layout/PageHeader'
import { AddressesPanel } from '../components/profile/AddressesPanel'
import { CertificationPanel } from '../components/profile/CertificationPanel'
import { EducationPanel } from '../components/profile/EducationPanel'
import { ExtraCurricularPanel } from '../components/profile/ExtraCurricularPanel'
import { IdentityCard } from '../components/profile/IdentityCard'
import { LinksPanel } from '../components/profile/LinksPanel'
import { ExperiencePanel } from '../components/ExperiencePanel'

/**
 * Who you are, split from Settings (which is app preferences).
 *
 * Left reads personal/academic top-to-bottom; right is the career stack.
 * Columns stretch to the same height on lg+; order stays fixed so the page
 * still reads as a profile, not a shuffled masonry wall. See
 * `.cursor/rules/profile-column-balance.mdc` when adding panels.
 */
export function ProfilePage() {
  return (
    <>
      <PageHeader title="My Profile" subtitle="Your identity and career story." />

      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <div className="flex h-full flex-col gap-4">
          <IdentityCard />
          <AddressesPanel />
          <EducationPanel />
        </div>
        <div className="flex h-full flex-col gap-4">
          <ExperiencePanel />
          <CertificationPanel />
          <ExtraCurricularPanel />
          <LinksPanel />
        </div>
      </div>
    </>
  )
}
