import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import LandingPage from './pages/LandingPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import RegistrationPage from './pages/RegistrationPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import ReportPage from './pages/ReportPage.jsx'
import TrackingPage from './pages/TrackingPage.jsx'
import StaffTasksPage from './pages/StaffTasksPage.jsx'
import AdminPage from './pages/AdminPage.jsx'
import QrCodesPage from './pages/QrCodesPage.jsx'
import ComplaintDetailPage from './pages/ComplaintDetailPage.jsx'
import NotificationsPage from './pages/NotificationsPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'

const Campus3DPage = lazy(() => import('./pages/Campus3DPage.jsx'))

function readAuth() {
  try {
    return JSON.parse(sessionStorage.getItem('campusfix.auth') ?? 'null')
  } catch {
    return null
  }
}

function ProtectedRoute({ roles, children }) {
  const auth = readAuth()
  const location = useLocation()
  if (!auth?.access_token || !roles.includes(auth.role)) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return children
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegistrationPage />} />
        <Route path="/dashboard" element={<ProtectedRoute roles={['student']}><DashboardPage /></ProtectedRoute>} />
        <Route path="/report" element={<ProtectedRoute roles={['student']}><ReportPage /></ProtectedRoute>} />
        <Route path="/tracking" element={<ProtectedRoute roles={['student']}><TrackingPage /></ProtectedRoute>} />
        <Route path="/staff/tasks" element={<ProtectedRoute roles={['staff']}><StaffTasksPage /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute roles={['admin']}><AdminPage /></ProtectedRoute>} />
        <Route path="/admin/qr-codes" element={<ProtectedRoute roles={['admin']}><QrCodesPage /></ProtectedRoute>} />
        <Route path="/admin/campus-3d" element={<ProtectedRoute roles={['admin']}><Suspense fallback={<div className="campus-loading">Loading campus view…</div>}><Campus3DPage /></Suspense></ProtectedRoute>} />
        <Route path="/complaints/:complaintId" element={<ProtectedRoute roles={['student', 'staff', 'admin']}><ComplaintDetailPage /></ProtectedRoute>} />
        <Route path="/notifications" element={<ProtectedRoute roles={['student', 'staff', 'admin']}><NotificationsPage /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute roles={['student', 'staff', 'admin']}><ProfilePage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
