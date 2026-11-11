import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { MotionConfig } from 'framer-motion';
import AuthProvider from './auth/AuthProvider';
import Login from './pages/Login';
import RegisterAccount from './pages/RegisterAccount';
import Dashboard from './pages/Dashboard';
import RegisterViolation from './pages/RegisterViolation';
import ViewViolations from './pages/ViewViolations';
import ProtectedRoute from './routes/ProtectedRoute';
import MainLayout from './components/Layout/MainLayout';

const Analytics = lazy(() => import('./pages/Analytics'));

function App() {
  return (
    <AuthProvider>
      <MotionConfig reducedMotion="user">
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<RegisterAccount />} />

          {/* Protected Routes wrapped in MainLayout */}
          <Route element={<MainLayout />}>
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/violations" element={<ViewViolations />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['admin', 'officer']} />}>
              <Route path="/register-violation" element={<RegisterViolation />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
              <Route path="/analytics" element={<Suspense fallback={<p role="status">Loading analytics...</p>}><Analytics /></Suspense>} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
      </MotionConfig>
    </AuthProvider>
  );
}

export default App;
