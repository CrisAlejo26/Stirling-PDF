import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@app/auth/UseSession";

export default function LoginPage() {
  const { user, refreshSession } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Si ya está autenticado, ir al inicio
  useEffect(() => {
    if (user) {
      navigate("/", { replace: true });
    }
  }, [user, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        await refreshSession();
        navigate("/", { replace: true });
      } else {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Credenciales incorrectas");
      }
    } catch {
      setError("Error de conexión. Verifica que el servidor esté activo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--color-bg, #f9fafb)",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "360px",
          backgroundColor: "var(--color-surface, #ffffff)",
          borderRadius: "16px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.10)",
          padding: "32px",
        }}
      >
        {/* Logo / título */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginBottom: "28px",
          }}
        >
          <img
            src="/favicon.svg"
            alt="PDFox"
            style={{ width: "48px", height: "48px", marginBottom: "12px" }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <h1
            style={{
              fontSize: "22px",
              fontWeight: 700,
              margin: 0,
              color: "var(--color-text, #111827)",
            }}
          >
            PDFox
          </h1>
          <p
            style={{
              fontSize: "14px",
              color: "var(--color-text-muted, #6b7280)",
              marginTop: "4px",
            }}
          >
            Inicia sesión para continuar
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
        >
          <div>
            <label
              htmlFor="username"
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: 500,
                color: "var(--color-text, #374151)",
                marginBottom: "4px",
              }}
            >
              Usuario o email
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="nombre.usuario o email@empresa.com"
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--color-border, #d1d5db)",
                fontSize: "14px",
                outline: "none",
                backgroundColor: "var(--color-input-bg, #fff)",
                color: "var(--color-text, #111827)",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: 500,
                color: "var(--color-text, #374151)",
                marginBottom: "4px",
              }}
            >
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--color-border, #d1d5db)",
                fontSize: "14px",
                outline: "none",
                backgroundColor: "var(--color-input-bg, #fff)",
                color: "var(--color-text, #111827)",
                boxSizing: "border-box",
              }}
            />
          </div>

          {error && (
            <p
              style={{
                fontSize: "13px",
                color: "#dc2626",
                textAlign: "center",
                margin: 0,
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: loading ? "#93c5fd" : "#2563eb",
              color: "#fff",
              fontWeight: 600,
              fontSize: "14px",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background-color 0.15s",
            }}
          >
            {loading ? "Iniciando sesión..." : "Iniciar sesión"}
          </button>
        </form>
      </div>
    </div>
  );
}
