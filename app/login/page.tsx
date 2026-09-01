// app/login/page.tsx
"use client";

import { useState } from "react";
import {
  Box,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  Stack,
  IconButton,
  InputAdornment,
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import { AuthShell } from "@/components/auth/AuthShell";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";

// Google 官方四色 G 标（内联 SVG，无外部依赖）
function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.42 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

const fieldSx = {
  "& .MuiOutlinedInput-root": { height: 56, borderRadius: "14px", bgcolor: "background.paper" },
  "& .MuiOutlinedInput-input": { padding: "16px", fontSize: 16 },
} as const;

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography
        component="label"
        htmlFor={id}
        sx={{ display: "block", fontSize: 14, fontWeight: 500, color: "text.primary", mb: 1 }}
      >
        {label}
      </Typography>
      {children}
    </Box>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn, signInWithGoogle } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(email, password);
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "登录失败，请检查账号密码");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError("");
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err.message || "Google 登录失败");
    }
  };

  return (
    <AuthShell title="欢迎回来" subtitle="登录你的 WorldCredit 账户" crossLinkHref="/register" crossLinkLabel="创建账户">
      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
          {error}
        </Alert>
      )}

      <form onSubmit={handleSubmit}>
        <Stack spacing={3}>
          <Field label="邮箱地址" id="login-email">
            <TextField
              id="login-email"
              fullWidth
              type="email"
              variant="outlined"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              sx={fieldSx}
            />
          </Field>
          <Field label="密码" id="login-password">
            <TextField
              id="login-password"
              fullWidth
              type={showPassword ? "text" : "password"}
              variant="outlined"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              sx={fieldSx}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                      onClick={() => setShowPassword(!showPassword)}
                      edge="end"
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          </Field>
          <Button
            fullWidth
            variant="contained"
            type="submit"
            disabled={loading}
            sx={{
              mt: 2,
              height: 56,
              borderRadius: "28px",
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            {loading ? <CircularProgress size={24} color="inherit" /> : "登录"}
          </Button>
        </Stack>
      </form>

      {/* 分隔线 + Google 登录 */}
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mt: 5, mb: 3 }}>
        <Box sx={{ flex: 1, height: 1, bgcolor: "divider" }} />
        <Typography variant="body2" color="text.secondary">
          或
        </Typography>
        <Box sx={{ flex: 1, height: 1, bgcolor: "divider" }} />
      </Stack>
      <Button
        fullWidth
        variant="outlined"
        onClick={handleGoogle}
        startIcon={<GoogleIcon />}
        sx={{
          height: 56,
          borderRadius: "28px",
          fontSize: 16,
          fontWeight: 600,
          color: "text.primary",
          borderColor: "divider",
          "&:hover": { bgcolor: "action.hover", borderColor: "divider" },
        }}
      >
        使用 Google 账户登录
      </Button>
    </AuthShell>
  );
}
