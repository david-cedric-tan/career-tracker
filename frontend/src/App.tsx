import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppearanceProvider } from './appearance/AppearanceProvider'
import { AuthProvider } from './auth/AuthContext'
import { CelebrationProvider } from './celebrate/CelebrationProvider'
import { GuestRoute, ProtectedRoute } from './auth/ProtectedRoute'
import { AccountSync } from './components/AccountSync'
import { AppLayout } from './components/layout/AppLayout'
import { ToastProvider } from './components/ui/Toast'
import { MentionLinksProvider } from './lib/mentionLinks'
import { ApplicationDetailPage } from './pages/ApplicationDetailPage'
import { ApplicationsPage } from './pages/ApplicationsPage'
import { CompanyDetailPage } from './pages/CompanyDetailPage'
import { JobListingDetailPage } from './pages/JobListingDetailPage'
import { JobDirectoryPage } from './pages/JobDirectoryPage'
import { CatchupsPage } from './pages/CatchupsPage'
import { DashboardPage } from './pages/DashboardPage'
import { FileDirectoryPage, ResumesRedirect } from './pages/FileDirectoryPage'
import { LoginPage } from './pages/LoginPage'
import { NetworkPage } from './pages/NetworkPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PersonDetailPage } from './pages/PersonDetailPage'
import { ProfilePage } from './pages/ProfilePage'
import { CalendarPage } from './pages/CalendarPage'
import { RegisterPage } from './pages/RegisterPage'
import { SettingsPage } from './pages/SettingsPage'
import { TodosPage } from './pages/TodosPage'

export default function App() {
  return (
    <BrowserRouter>
      <CelebrationProvider>
        <ToastProvider>
          <AuthProvider>
            <AppearanceProvider>
              <AccountSync />
              <Routes>
                <Route element={<GuestRoute />}>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/register" element={<RegisterPage />} />
                </Route>

                <Route element={<ProtectedRoute />}>
                  <Route
                    element={
                      <MentionLinksProvider>
                        <AppLayout />
                      </MentionLinksProvider>
                    }
                  >
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/applications" element={<ApplicationsPage />} />
                    <Route path="/applications/:id" element={<ApplicationDetailPage />} />
                    <Route path="/network" element={<NetworkPage />} />
                    <Route path="/network/:id" element={<PersonDetailPage />} />
                    <Route path="/catchups" element={<CatchupsPage />} />
                    <Route path="/catchups/:id" element={<CatchupsPage />} />
                    <Route path="/todos" element={<TodosPage />} />
                    <Route path="/calendar" element={<CalendarPage />} />
                    <Route path="/files" element={<FileDirectoryPage />} />
                    <Route path="/resumes" element={<ResumesRedirect />} />
                    <Route path="/job-directory" element={<JobDirectoryPage />} />
                    <Route path="/job-directory/companies/:id" element={<CompanyDetailPage />} />
                    <Route path="/job-directory/listings/:id" element={<JobListingDetailPage />} />
                    <Route path="/profile" element={<ProfilePage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Route>
              </Routes>
            </AppearanceProvider>
          </AuthProvider>
        </ToastProvider>
      </CelebrationProvider>
    </BrowserRouter>
  )
}
