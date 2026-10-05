import { createTheme } from '@mui/material'

// 中文优先字体栈：系统 Latin → 原生 CJK（苹方/鸿蒙/小米）→ Webfont Noto Sans SC → 雅黑兜底。
// Webfont 由 @fontsource-variable/noto-sans-sc 提供（在 ThemeRegistry 中 import），按 unicode-range 子集按需加载。
export const fontStack = [
  '-apple-system',
  'BlinkMacSystemFont',
  'Segoe UI',
  'Roboto',
  'PingFang SC',
  'HarmonyOS Sans SC',
  'MiSans',
  'Noto Sans SC Variable',
  'Noto Sans SC',
  'Microsoft YaHei',
  'sans-serif',
].join(', ')

// 亮色主题：以移动端蓝 (#1976d2) 为基底的全站唯一亮色世界。
// 主色白字对比 ≈4.6:1，语义色均按 WCAG AA 校验。
export const lightTheme = createTheme({
  palette: {
    primary: {
      main: '#1976d2',
      light: '#42a5f5',
      dark: '#1565c0',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#030059',
      light: '#7AADFF',
      dark: '#02003d',
      contrastText: '#ffffff',
    },
    info: {
      main: '#0277bd',
      contrastText: '#ffffff',
    },
    success: {
      main: '#2e7d32',
      contrastText: '#ffffff',
    },
    warning: {
      main: '#ed6c02',
      contrastText: '#030059',
    },
    error: {
      main: '#d32f2f',
      contrastText: '#ffffff',
    },
    background: {
      default: '#F5F8FF',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#0A1F44',
      secondary: '#5B6478',
      disabled: '#A0A8B8',
    },
    divider: '#DDDDDD',
  },
  typography: {
    fontFamily: fontStack,
    h1: { fontSize: '32px', fontWeight: 600, lineHeight: 1.3, color: '#030059' },
    h2: { fontSize: '24px', fontWeight: 600, lineHeight: 1.35, color: '#030059' },
    h3: { fontSize: '16px', fontWeight: 600, lineHeight: 1.5, color: '#030059' },
    // 文本色统一到 .phone 体系（globals.css --text-primary/--text-secondary），
    // 不再另存一套 #333333/#636363：否则同屏会出现两种「正文色」。
    subtitle1: { fontSize: '18px', fontWeight: 500, lineHeight: 1.6, color: '#0A1F44' },
    subtitle2: { fontSize: '14px', fontWeight: 700, lineHeight: 1.5, color: '#0A1F44' },
    body1: { fontSize: '16px', fontWeight: 400, lineHeight: 1.6, color: '#0A1F44' },
    body2: { fontSize: '14px', fontWeight: 400, lineHeight: 1.5, color: '#5B6478' },
    button: { fontSize: '14px', fontWeight: 600, textTransform: 'none' },
  },
  shape: {
    borderRadius: 5,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          borderRadius: 3,
          height: 40,
          padding: '0px 20px',
          transition: 'background-color 200ms ease, border-color 200ms ease, color 200ms ease',
          '&:focus-visible': {
            outline: '2px solid #030059',
            outlineOffset: 2,
          },
        },
        // 主色作文字时用 dark 档（#1565c0，雾底 #F5F8FF 上 5.4:1），保证 AA；
        // 主色作填充时用 main 档（#1976d2，白字 4.6:1）。
        textPrimary: {
          color: '#1565c0',
        },
        outlinedPrimary: {
          color: '#1565c0',
          borderColor: 'rgba(21, 101, 192, 0.5)',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: '#FFFFFF',
          borderRadius: 5,
          border: '1px solid #DDDDDD',
          boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.08)',
          // 不要在 Card 根上设 padding：MUI 的 <CardContent> 自带内距，
          // 两者叠加会让每张卡左右各多出 24px（实测 40–44px），窄屏下
          // 直接把 140px 的小卡内容压到 ~60px，金额与标签被裁。
          // 内距交由 CardContent（16/24px）或各页面显式控制。
          color: '#0A1F44',
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: '#FFFFFF',
          borderRadius: 5,
          height: 40,
          fontSize: 16,
          color: '#0A1F44',
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: '#CCCCCC',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(25, 118, 210, 0.5)',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#1976d2',
            borderWidth: 1,
          },
          '&.Mui-focused': {
            boxShadow: '0px 0px 0px 3px rgba(25, 118, 210, 0.15)',
          },
        },
        input: {
          padding: '8px 12px',
          '&::placeholder': {
            color: '#5B6478',
            opacity: 0.8,
          },
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          fontSize: 16,
          color: '#0A1F44',
          marginBottom: 8,
          position: 'relative',
          transform: 'none',
          '&.Mui-focused': {
            color: '#1976d2',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          fontWeight: 700,
          fontSize: 12,
          padding: '4px 12px',
          height: 'auto',
        },
      },
    },
    MuiLink: {
      styleOverrides: {
        root: {
          color: '#1565c0',
          textDecoration: 'underline',
          '&:hover': {
            color: '#0d47a1',
          },
        },
      },
    },
  },
})

// 暗色主题：管理后台专用运营台（/admin）。
// 基底沿用管理端既定的深灰蓝世界：#181a24 底 / #1e2028 面板 / 靛蓝主色（填充用 #4f46e5，白字 6.3:1；暗底文字用 light #818cf8，5.8:1）。
export const adminDarkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#4f46e5',
      light: '#818cf8',
      dark: '#4338ca',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#818cf8',
      contrastText: '#0e1017',
    },
    info: {
      main: '#29b6f6',
      contrastText: '#0a1929',
    },
    success: {
      main: '#10b981',
      contrastText: '#052e16',
    },
    warning: {
      main: '#f59e0b',
      contrastText: '#271700',
    },
    error: {
      main: '#f87171',
      light: '#fca5a5',
      dark: '#ef4444',
      contrastText: '#450a0a',
    },
    background: {
      default: '#181a24',
      paper: '#1e2028',
    },
    text: {
      primary: '#e4e6eb',
      secondary: '#9ca3af',
      disabled: '#6b7280',
    },
    divider: 'rgba(255, 255, 255, 0.08)',
  },
  typography: {
    fontFamily: fontStack,
    button: { fontSize: '14px', fontWeight: 600, textTransform: 'none' },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          borderRadius: 8,
          height: 40,
          padding: '0px 20px',
          transition: 'background-color 200ms ease, border-color 200ms ease, color 200ms ease',
          '&:focus-visible': {
            outline: '2px solid #818cf8',
            outlineOffset: 2,
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
  },
})
