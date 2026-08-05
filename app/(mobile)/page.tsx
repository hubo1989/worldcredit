// app/(mobile)/page.tsx
"use client";

import { useEffect, useState } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  CircularProgress,
  IconButton,
  Button,
  LinearProgress,
  Stack,
} from "@mui/material";
import {
  CreditCard as CreditCardIcon,
  Notifications as BellIcon,
  Add as AddIcon,
  ChevronRight as ChevronRightIcon,
} from "@mui/icons-material";
import { useAuth } from "@/lib/auth";
import { insforge } from "@/lib/insforge";

export default function HomePage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ cards: 0, holders: 0, totalLimit: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [cardsRes, holdersRes] = await Promise.all([
          insforge.database.from("credit_cards").select("*", { count: "exact", head: true }),
          insforge.database.from("card_holders").select("*", { count: "exact", head: true }),
        ]);

        // 由于没有数据，这里设定一些默认值演示 UI
        setStats({
          cards: cardsRes.count || 0,
          holders: holdersRes.count || 0,
          totalLimit: 0,
        });
      } catch (err) {
        console.error("Fetch stats failed:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  if (loading) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, pb: 4 }}>
      {/* Header */}
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Box>
          <Typography variant="h6" fontWeight={800}>
            👋 Hi, {user?.name || "管理员"}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            今天有 0 笔待还款项
          </Typography>
        </Box>
        <IconButton sx={{ bgcolor: "white", border: "1px solid #eee" }}>
          <BellIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Overview Card */}
      <Card
        sx={{
          background: "linear-gradient(135deg, #1976d2 0%, #1565c0 100%)",
          color: "white",
          borderRadius: 4,
          mb: 3,
          boxShadow: "0 8px 16px rgba(25, 118, 210, 0.2)",
        }}
      >
        <CardContent sx={{ p: 3 }}>
          <Typography variant="body2" sx={{ opacity: 0.8, mb: 0.5 }}>
            已用总额度
          </Typography>
          <Typography variant="h4" fontWeight={800}>
            ¥ 0.00
          </Typography>
          <Box sx={{ mt: 3 }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
              <Typography variant="caption" sx={{ opacity: 0.8 }}>
                额度使用率 0%
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.8 }}>
                ¥ 0 / ¥ 0
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={0}
              sx={{
                height: 8,
                borderRadius: 4,
                bgcolor: "rgba(255,255,255,0.2)",
                "& .MuiLinearProgress-bar": { bgcolor: "white" },
              }}
            />
          </Box>
        </CardContent>
      </Card>

      {/* Quick Stats Grid */}
      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Grid item xs={6}>
          <Card sx={{ borderRadius: 4 }}>
            <CardContent sx={{ p: 2 }}>
              <Typography color="text.secondary" variant="body2">
                持卡对象
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                {stats.holders}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6}>
          <Card sx={{ borderRadius: 4 }}>
            <CardContent sx={{ p: 2 }}>
              <Typography color="text.secondary" variant="body2">
                信用卡
              </Typography>
              <Typography variant="h5" fontWeight={700}>
                {stats.cards}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Empty State */}
      <Box
        sx={{
          textAlign: "center",
          p: 4,
          bgcolor: "#fff",
          borderRadius: 4,
          border: "2px dashed #eee",
        }}
      >
        <CreditCardIcon sx={{ fontSize: 48, color: "#ccc", mb: 2 }} />
        <Typography variant="subtitle1" fontWeight={600}>
          暂无信用卡数据
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          添加持卡人后，即可录入其名下的信用卡
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          sx={{ borderRadius: 3, px: 4 }}
          href="/holders"
        >
          立即开始
        </Button>
      </Box>

      {/* Holder Previews */}
      <Box sx={{ mt: 4 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            持卡人
          </Typography>
          <Button size="small" endIcon={<ChevronRightIcon />}>
            全部
          </Button>
        </Box>
        <Stack direction="row" spacing={2} sx={{ overflowX: "auto", pb: 2 }}>
          <IconButton
            sx={{
              width: 56,
              height: 56,
              border: "1px dashed #999",
              flexShrink: 0,
            }}
          >
            <AddIcon />
          </IconButton>
        </Stack>
      </Box>
    </Box>
  );
}
