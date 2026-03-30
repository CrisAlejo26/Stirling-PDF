import { useEffect, useState, useCallback } from "react";
import {
  Stack,
  Group,
  Text,
  Badge,
  Button,
  TextInput,
  PasswordInput,
  Select,
  Table,
  Modal,
  Alert,
  Loader,
  ActionIcon,
  Pagination,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { Z_INDEX_OVER_CONFIG_MODAL } from "@app/styles/zIndex";
import LocalIcon from "@app/components/shared/LocalIcon";

interface UserRecord {
  id: string;
  name: string;
  username: string;
  loginName: string;
  role: "ADMIN" | "EDITOR" | "VIEWER";
  enabled: boolean;
  createdAt: string;
}

interface PagedResponse {
  content: UserRecord[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
}

const ROLE_COLORS: Record<string, "grape" | "blue" | "gray"> = {
  ADMIN: "grape",
  EDITOR: "blue",
  VIEWER: "gray",
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  EDITOR: "Editor",
  VIEWER: "Visor",
};

const PAGE_SIZE = 20;

export default function UsersSection() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [totalElements, setTotalElements] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, 300);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);

  // Create form
  const [form, setForm] = useState({
    name: "",
    username: "",
    loginName: "",
    password: "",
    role: "EDITOR" as "ADMIN" | "EDITOR" | "VIEWER",
  });
  const [formError, setFormError] = useState("");
  const [formLoading, setFormLoading] = useState(false);

  // Edit modal
  const [editTarget, setEditTarget] = useState<UserRecord | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    loginName: "",
    role: "EDITOR" as "ADMIN" | "EDITOR" | "VIEWER",
    enabled: true,
  });
  const [editError, setEditError] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  // Reset password modal
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  const fetchUsers = useCallback(async (p: number, q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(p - 1),
        size: String(PAGE_SIZE),
        search: q,
      });
      const res = await fetch(`/api/v1/admin/users?${params.toString()}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = (await res.json()) as PagedResponse | UserRecord[];
        // Soporte para respuesta paginada y respuesta legacy (array plano)
        if (Array.isArray(data)) {
          setUsers(data);
          setTotalPages(1);
          setTotalElements(data.length);
        } else {
          setUsers(data.content ?? []);
          setTotalPages(data.totalPages ?? 1);
          setTotalElements(data.totalElements ?? 0);
        }
      } else {
        setError("No tienes permiso para ver esta sección.");
      }
    } catch {
      setError("Error al cargar usuarios.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers(page, debouncedSearch);
  }, [page, debouncedSearch, fetchUsers]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

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
        setForm({ name: "", username: "", loginName: "", password: "", role: "EDITOR" });
        await fetchUsers(page, debouncedSearch);
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

  const openEdit = (user: UserRecord) => {
    setEditTarget(user);
    setEditForm({
      name: user.name,
      loginName: user.loginName ?? "",
      role: user.role,
      enabled: user.enabled,
    });
    setEditError("");
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setEditError("");
    setEditLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/users/${editTarget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        setEditTarget(null);
        await fetchUsers(page, debouncedSearch);
      } else {
        const data = (await res.json()) as { error?: string };
        setEditError(data.error ?? "Error al actualizar usuario.");
      }
    } catch {
      setEditError("Error de conexión.");
    } finally {
      setEditLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este usuario?")) return;
    await fetch(`/api/v1/admin/users/${id}`, { method: "DELETE", credentials: "include" });
    const newPage = users.length === 1 && page > 1 ? page - 1 : page;
    setPage(newPage);
    await fetchUsers(newPage, debouncedSearch);
  };

  const handleResetPassword = async () => {
    if (!resetTarget || !newPassword) return;
    setResetLoading(true);
    await fetch(`/api/v1/admin/users/${resetTarget}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ password: newPassword }),
    });
    setResetLoading(false);
    setResetTarget(null);
    setNewPassword("");
  };

  if (error) {
    return <Alert color="red" m="md">{error}</Alert>;
  }

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between">
        <Text fw={600} size="sm">
          Gestión de usuarios
          {!loading && (
            <Text span size="xs" c="dimmed" ml={6}>
              ({totalElements} total)
            </Text>
          )}
        </Text>
        <Button
          size="xs"
          variant={showForm ? "light" : "filled"}
          color={showForm ? "gray" : "blue"}
          leftSection={
            <LocalIcon
              icon={showForm ? "close-rounded" : "add-rounded"}
              width="0.9rem"
              height="0.9rem"
            />
          }
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? "Cancelar" : "Nuevo usuario"}
        </Button>
      </Group>

      {/* Formulario crear usuario */}
      {showForm && (
        <form onSubmit={handleCreate}>
          <Stack
            gap="xs"
            p="sm"
            style={{
              background: "var(--mantine-color-default-hover)",
              borderRadius: "var(--mantine-radius-md)",
            }}
          >
            <Group grow>
              <TextInput
                required
                size="xs"
                label="Nombre"
                placeholder="Juan García"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <TextInput
                required
                size="xs"
                label="Email"
                type="email"
                placeholder="juan@empresa.com"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </Group>
            <Group grow>
              <TextInput
                size="xs"
                label="Nombre de usuario"
                placeholder="juan.garcia (opcional)"
                value={form.loginName}
                onChange={(e) => setForm({ ...form, loginName: e.target.value })}
              />
              <PasswordInput
                required
                size="xs"
                label="Contraseña"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Group>
            <Group grow>
              <Select
                size="xs"
                label="Rol"
                value={form.role}
                onChange={(v) =>
                  setForm({ ...form, role: (v ?? "EDITOR") as "ADMIN" | "EDITOR" | "VIEWER" })
                }
                data={[
                  { value: "EDITOR", label: "Editor" },
                  { value: "VIEWER", label: "Visor" },
                  { value: "ADMIN", label: "Admin" },
                ]}
                comboboxProps={{ zIndex: Z_INDEX_OVER_CONFIG_MODAL + 10 }}
              />
            </Group>
            {formError && <Text size="xs" c="red">{formError}</Text>}
            <Button type="submit" size="xs" color="green" loading={formLoading} fullWidth>
              Crear usuario
            </Button>
          </Stack>
        </form>
      )}

      {/* Búsqueda */}
      <TextInput
        size="xs"
        placeholder="Buscar por nombre, email o usuario..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        leftSection={<LocalIcon icon="search-rounded" width="0.85rem" height="0.85rem" />}
        rightSection={
          search ? (
            <ActionIcon size="xs" variant="subtle" onClick={() => setSearch("")}>
              <LocalIcon icon="close-rounded" width="0.75rem" height="0.75rem" />
            </ActionIcon>
          ) : null
        }
      />

      {/* Tabla */}
      {loading ? (
        <Stack align="center" py="lg">
          <Loader size="sm" />
        </Stack>
      ) : (
        <>
          <Table striped highlightOnHover withTableBorder withColumnBorders fz="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nombre</Table.Th>
                <Table.Th>Email</Table.Th>
                <Table.Th>Usuario</Table.Th>
                <Table.Th>Rol</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th style={{ textAlign: "right" }}>Acciones</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {users.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6} style={{ textAlign: "center" }}>
                    <Text size="xs" c="dimmed" py="sm">
                      No se encontraron usuarios
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                users.map((user) => (
                  <Table.Tr key={user.id}>
                    <Table.Td fw={500}>{user.name}</Table.Td>
                    <Table.Td c="dimmed">{user.username}</Table.Td>
                    <Table.Td c="dimmed">
                      {user.loginName || (
                        <Text size="xs" c="dimmed" fs="italic">—</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" color={ROLE_COLORS[user.role]} variant="light">
                        {ROLE_LABELS[user.role]}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="xs"
                        color={user.enabled ? "green" : "red"}
                        variant="light"
                        style={{ cursor: "pointer" }}
                        onClick={() => void (async () => {
                          await fetch(`/api/v1/admin/users/${user.id}`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({
                              name: user.name,
                              loginName: user.loginName,
                              role: user.role,
                              enabled: !user.enabled,
                            }),
                          });
                          await fetchUsers(page, debouncedSearch);
                        })()}
                      >
                        {user.enabled ? "Activo" : "Inactivo"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Group justify="flex-end" gap="xs">
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          color="gray"
                          title="Editar usuario"
                          onClick={() => openEdit(user)}
                        >
                          <LocalIcon icon="edit-rounded" width="0.85rem" height="0.85rem" />
                        </ActionIcon>
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          color="blue"
                          title="Cambiar contraseña"
                          onClick={() => setResetTarget(user.id)}
                        >
                          <LocalIcon icon="lock-reset-rounded" width="0.85rem" height="0.85rem" />
                        </ActionIcon>
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          color="red"
                          title="Eliminar usuario"
                          onClick={() => void handleDelete(user.id)}
                        >
                          <LocalIcon icon="delete-rounded" width="0.85rem" height="0.85rem" />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>

          {totalPages > 1 && (
            <Group justify="center">
              <Pagination size="xs" total={totalPages} value={page} onChange={setPage} />
            </Group>
          )}
        </>
      )}

      {/* Modal editar usuario */}
      <Modal
        opened={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title={`Editar usuario — ${editTarget?.username ?? ""}`}
        size="sm"
        centered
        zIndex={Z_INDEX_OVER_CONFIG_MODAL}
      >
        <form onSubmit={handleEdit}>
          <Stack gap="sm">
            <TextInput
              required
              label="Nombre"
              placeholder="Juan García"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            />
            <TextInput
              label="Nombre de usuario"
              placeholder="juan.garcia (opcional)"
              value={editForm.loginName}
              onChange={(e) => setEditForm({ ...editForm, loginName: e.target.value })}
            />
            <Select
              label="Rol"
              value={editForm.role}
              onChange={(v) =>
                setEditForm({
                  ...editForm,
                  role: (v ?? "EDITOR") as "ADMIN" | "EDITOR" | "VIEWER",
                })
              }
              data={[
                { value: "EDITOR", label: "Editor" },
                { value: "VIEWER", label: "Visor" },
                { value: "ADMIN", label: "Admin" },
              ]}
              comboboxProps={{ zIndex: Z_INDEX_OVER_CONFIG_MODAL + 10 }}
            />
            <Select
              label="Estado"
              value={editForm.enabled ? "true" : "false"}
              onChange={(v) => setEditForm({ ...editForm, enabled: v === "true" })}
              data={[
                { value: "true", label: "Activo" },
                { value: "false", label: "Inactivo" },
              ]}
              comboboxProps={{ zIndex: Z_INDEX_OVER_CONFIG_MODAL + 10 }}
            />
            {editError && <Text size="xs" c="red">{editError}</Text>}
            <Group justify="flex-end">
              <Button variant="default" size="sm" onClick={() => setEditTarget(null)}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" loading={editLoading}>
                Guardar cambios
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* Modal cambiar contraseña */}
      <Modal
        opened={resetTarget !== null}
        onClose={() => { setResetTarget(null); setNewPassword(""); }}
        title="Cambiar contraseña"
        size="sm"
        centered
        zIndex={Z_INDEX_OVER_CONFIG_MODAL}
      >
        <Stack gap="sm">
          <PasswordInput
            label="Nueva contraseña"
            placeholder="••••••••"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              size="sm"
              onClick={() => { setResetTarget(null); setNewPassword(""); }}
            >
              Cancelar
            </Button>
            <Button size="sm" loading={resetLoading} onClick={() => void handleResetPassword()}>
              Guardar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
