import { Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppProviders } from "@app/components/AppProviders";
import { AppLayout } from "@app/components/AppLayout";
import { LoadingFallback } from "@app/components/shared/LoadingFallback";
import { RainbowThemeProvider } from "@app/components/shared/RainbowThemeProvider";
import { PreferencesProvider } from "@app/contexts/PreferencesContext";
import HomePage from "@app/pages/HomePage";
import MobileScannerPage from "@app/pages/MobileScannerPage";
import Onboarding from "@app/components/onboarding/Onboarding";
import LoginPage from "@app/pages/LoginPage";
import AdminUsersPage from "@app/pages/AdminUsersPage";
import { AuthProvider, useAuth } from "@app/auth/UseSession";

// Import global styles
import "@app/styles/tailwind.css";
import "@app/styles/cookieconsent.css";
import "@app/styles/index.css";

// Import file ID debugging helpers (development only)
import "@app/utils/fileIdSafety";

// Minimal providers for mobile scanner - no API calls, no authentication
function MobileScannerProviders({ children }: { children: React.ReactNode }) {
  return (
    <PreferencesProvider>
      <RainbowThemeProvider>{children}</RainbowThemeProvider>
    </PreferencesProvider>
  );
}

// Redirige a /login si el usuario no está autenticado
function ProtectedRoute({
  children,
  adminOnly = false,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingFallback />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && user.role !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          {/* Mobile scanner route - no backend needed, pure P2P WebRTC */}
          <Route
            path="/mobile-scanner"
            element={
              <MobileScannerProviders>
                <MobileScannerPage />
              </MobileScannerProviders>
            }
          />

          {/* Login — sin auth, pero con providers de tema */}
          <Route
            path="/login"
            element={
              <MobileScannerProviders>
                <LoginPage />
              </MobileScannerProviders>
            }
          />

          {/* Admin panel — solo ADMIN */}
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute adminOnly>
                <AdminUsersPage />
              </ProtectedRoute>
            }
          />

          {/* All other routes need AppProviders + auth */}
          <Route
            path="*"
            element={
              <ProtectedRoute>
                <AppProviders>
                  <AppLayout>
                    <HomePage />
                    <Onboarding />
                  </AppLayout>
                </AppProviders>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
