import type { ReactNode } from "react";
import { useAuth } from "@app/auth/UseSession";
import type { AuthUser } from "@app/auth/UseSession";

interface RoleGuardProps {
  roles: AuthUser["role"][];
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Renderiza `children` solo si el usuario autenticado tiene uno de los roles indicados.
 * Usa `fallback` (o nada) en caso contrario.
 */
export function RoleGuard({ roles, children, fallback = null }: RoleGuardProps) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}
