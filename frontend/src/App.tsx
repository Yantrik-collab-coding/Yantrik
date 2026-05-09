import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './lib/store'
import LandingPage        from './pages/LandingPage'
import AuthPage           from './pages/AuthPage'
import Dashboard          from './pages/Dashboard'
import ProjectPage        from './pages/ProjectPage'
import ProfilePage        from './pages/ProfilePage'
import ForumPage          from './pages/ForumPage'
import PublicProjectPage  from './pages/PublicProjectPage'
// import PricingPage        from './pages/PricingPage'  // DISABLED — testing/friends phase
import HowToUsePage       from './pages/HowToUsePage'
import HackathonPage      from './pages/HackathonPage'
import HackathonDetailPage from './pages/HackathonDetailPage'
import api from './lib/api'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token } = useAuthStore()
  return token ? <>{children}</> : <Navigate to="/auth" replace />
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuthStore()
  return token ? <Navigate to="/" replace /> : <>{children}</>
}

export default function App() {
  const { token, setAuth, logout } = useAuthStore()

  useEffect(() => {
    if (token) {
      api.get('/auth/me')
        .then(r => setAuth(r.data, token))
        .catch(() => {
          // Token is invalid or expired — clear it so the user is sent to login
          logout()
        })
    }
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"            element={<LandingPage />} />
        <Route path="/auth"        element={<GuestRoute><AuthPage /></GuestRoute>} />
        <Route path="/dashboard"   element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/project/:id" element={<RequireAuth><ProjectPage /></RequireAuth>} />
        <Route path="/profile"     element={<RequireAuth><ProfilePage /></RequireAuth>} />
        <Route path="/forum"       element={<ForumPage />} />
        <Route path="/forum/:id"   element={<PublicProjectPage />} />
        {/* <Route path="/pricing"     element={<PricingPage />} /> */}{/* DISABLED — testing/friends phase */}
        <Route path="/how-to-use"  element={<HowToUsePage />} />
        <Route path="/hackathon"   element={<HackathonPage />} />
        <Route path="/hackathon/:id" element={<HackathonDetailPage />} />
      </Routes>
    </BrowserRouter>
  )
}
