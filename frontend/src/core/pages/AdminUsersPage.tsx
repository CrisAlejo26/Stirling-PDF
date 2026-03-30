import { useEffect, useState } from "react";

interface UserRecord {
  id: string;
  name: string;
  username: string;
  loginName: string;
  role: "ADMIN" | "EDITOR" | "VIEWER";
  enabled: boolean;
  createdAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  EDITOR: "Editor",
  VIEWER: "Visor",
};

const ROLE_COLORS: Record<string, string> = {
  ADMIN: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  EDITOR: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  VIEWER: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);

  // form state
  const [form, setForm] = useState({
    name: "",
    username: "",
    password: "",
    role: "EDITOR" as "ADMIN" | "EDITOR" | "VIEWER",
  });
  const [formError, setFormError] = useState("");
  const [formLoading, setFormLoading] = useState(false);

  // reset password modal
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/admin/users", {
        credentials: "include",
      });
      if (res.ok) {
        setUsers((await res.json()) as UserRecord[]);
      } else {
        setError("No tienes permiso para ver esta página.");
      }
    } catch {
      setError("Error al cargar usuarios.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchUsers();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setFormLoading(true);
    try {
      const res = await fetch("/api/v1/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowForm(false);
        setForm({ name: "", username: "", password: "", role: "EDITOR" });
        await fetchUsers();
      } else {
        const data = (await res.json()) as { error?: string };
        setFormError(data.error ?? "Error al crear usuario.");
      }
    } catch {
      setFormError("Error de conexión.");
    } finally {
      setFormLoading(false);
    }
  };

  const toggleEnabled = async (user: UserRecord) => {
    await fetch(`/api/v1/admin/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        name: user.name,
        role: user.role,
        enabled: !user.enabled,
      }),
    });
    await fetchUsers();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este usuario?")) return;
    await fetch(`/api/v1/admin/users/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    await fetchUsers();
  };

  const handleResetPassword = async () => {
    if (!resetTarget || !newPassword) return;
    await fetch(`/api/v1/admin/users/${resetTarget}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ password: newPassword }),
    });
    setResetTarget(null);
    setNewPassword("");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500 dark:text-gray-400">Cargando usuarios...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Gestión de usuarios
        </h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium transition-colors"
        >
          {showForm ? "Cancelar" : "+ Nuevo usuario"}
        </button>
      </div>

      {/* Formulario crear usuario */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          <input
            required
            placeholder="Nombre"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
          />
          <input
            required
            type="email"
            placeholder="Email"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
          />
          <input
            required
            type="password"
            placeholder="Contraseña"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
          />
          <select
            value={form.role}
            onChange={(e) =>
              setForm({
                ...form,
                role: e.target.value as "ADMIN" | "EDITOR" | "VIEWER",
              })
            }
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
          >
            <option value="EDITOR">Editor</option>
            <option value="VIEWER">Visor</option>
            <option value="ADMIN">Admin</option>
          </select>
          {formError && (
            <p className="sm:col-span-2 text-sm text-red-500">{formError}</p>
          )}
          <button
            type="submit"
            disabled={formLoading}
            className="sm:col-span-2 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors"
          >
            {formLoading ? "Creando..." : "Crear usuario"}
          </button>
        </form>
      )}

      {/* Tabla de usuarios */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                Nombre
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                Email
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                Rol
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                Estado
              </th>
              <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.id}
                className="border-b border-gray-100 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-750"
              >
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                  {user.name}
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                  {user.username}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[user.role]}`}
                  >
                    {ROLE_LABELS[user.role]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => void toggleEnabled(user)}
                    className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                      user.enabled
                        ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-200"
                        : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 hover:bg-red-200"
                    }`}
                  >
                    {user.enabled ? "Activo" : "Inactivo"}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setResetTarget(user.id)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Cambiar clave
                    </button>
                    <button
                      onClick={() => void handleDelete(user.id)}
                      className="text-xs text-red-600 dark:text-red-400 hover:underline"
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal reset contraseña */}
      {resetTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              Cambiar contraseña
            </h2>
            <input
              type="password"
              placeholder="Nueva contraseña"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={() => void handleResetPassword()}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium"
              >
                Guardar
              </button>
              <button
                onClick={() => {
                  setResetTarget(null);
                  setNewPassword("");
                }}
                className="flex-1 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white text-sm rounded-lg font-medium"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
