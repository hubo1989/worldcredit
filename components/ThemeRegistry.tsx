// components/ThemeRegistry.tsx
'use client'

import { ThemeProvider, createTheme, CssBaseline } from '@mui/material'
import { ReactNode } from 'react'

const theme = createTheme({
  palette: {
    primary: { main: '#1976d2' },
    secondary: { main: '#9c27b0' },
  },
  typography: {
    fontFamily: '"Roboto", "Noto Sans SC", sans-serif',
  },
  shape: { borderRadius: 12 },
})

export function ThemeRegistry({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  )
}
