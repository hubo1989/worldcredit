// app/login/page.tsx
"use client";

import { useState } from "react";
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
} from "@mui/material";
import { CreditCard as CreditCardIcon } from "@mui/icons-material";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(email, password);
      router.push("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "登录失败，请检查账号密码");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
        p: 2,
      }}
    >
      <Card sx={{ maxWidth: 400, width: "100%", borderRadius: 4 }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ textAlign: "center", mb: 4 }}>
            <Box
              sx={{
                width: 64,
                height: 64,
                bgcolor: "primary.main",
                borderRadius: "50%",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                mb: 2,
              }}
            >
              <CreditCardIcon sx={{ fontSize: 36, color: "white" }} />
            </Box>
            <Typography variant="h5" fontWeight={800} color="primary">
              WorldCredit
            </Typography>
            <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
              家庭信用卡智能管理系统
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="邮箱地址"
              type="email"
              margin="normal"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              variant="outlined"
            />
            <TextField
              fullWidth
              label="输入密码"
              type="password"
              margin="normal"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              variant="outlined"
            />
            <Button
              fullWidth
              variant="contained"
              type="submit"
              size="large"
              disabled={loading}
              sx={{ mt: 4, py: 1.5, borderRadius: 3 }}
            >
              {loading ? <CircularProgress size={24} color="inherit" /> : "登录系统"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
