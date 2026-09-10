import { PageHeader } from '../components/layout/PageHeader'
import { AddressesPanel } from '../components/profile/AddressesPanel'
import { CertificationPanel } from '../components/profile/CertificationPanel'
import { EducationPanel } from '../components/profile/EducationPanel'
import { ExtraCurricularPanel } from '../components/profile/ExtraCurricularPanel'
import { IdentityCard } from '../components/profile/IdentityCard'
import { LinksPanel } from '../components/profile/LinksPanel'
import { ExperiencePanel } from '../components/ExperiencePanel'

/**
 * Who you are, split from Settings (which is app preferences). Identity up
 * top, then your career story — experience, education, extra-curriculars,
 * certifications — and finally the lightweight optional extras (links,
 * addresses).
 */
export function ProfilePage() {
  return (
    <>
      <PageHeader title="My Profile" subtitle="Your identity and career story." />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <IdentityCard />
          <ExperiencePanel />
          <EducationPanel />
        </div>
        <div className="flex flex-col gap-4">
          <CertificationPanel />
          <ExtraCurricularPanel />
          <LinksPanel />
          <AddressesPanel />
        </div>
      </div>
    </>
  )
}
