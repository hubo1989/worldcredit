'use client'

import { ThemeProvider, createTheme, CssBaseline, GlobalStyles } from '@mui/material'
import { ReactNode } from 'react'

/**
 * Solutions Treatment Center Design System Theme
 * Deep Navy (#030059) + Calming Sky Blues (#7AADFF, #A2C6FF)
 */
const theme = createTheme({
  palette: {
    primary: {
      main: '#030059',
      light: '#7AADFF',
      dark: '#02003d',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#7AADFF',
      light: '#A2C6FF',
      dark: '#007CBA',
      contrastText: '#ffffff',
    },
    info: {
      main: '#A2C6FF',
      light: '#F5F8FF',
      dark: '#7AADFF',
      contrastText: '#030059',
    },
    success: {
      main: '#00AA00',
      light: '#E6F7E6',
      dark: '#007700',
    },
    warning: {
      main: '#FCB900',
      contrastText: '#030059',
    },
    error: {
      main: '#CF2E2E',
      contrastText: '#ffffff',
    },
    background: {
      default: '#F5F8FF', // Soft sky light background
      paper: '#FFFFFF',
    },
    text: {
      primary: '#333333',
      secondary: '#636363',
      disabled: '#999999',
    },
    divider: '#DDDDDD',
  },
  typography: {
    fontFamily: '"Open Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    h1: {
      fontSize: '32px',
      fontWeight: 300,
      lineHeight: '51.2px',
      color: '#030059',
    },
    h2: {
      fontSize: '24px',
      fontWeight: 300,
      lineHeight: '38.4px',
      color: '#030059',
    },
    h3: {
      fontSize: '16px',
      fontWeight: 400,
      lineHeight: '24px',
      color: '#030059',
    },
    subtitle1: {
      fontSize: '18px',
      fontWeight: 400,
      lineHeight: '28.8px',
      color: '#333333',
    },
    subtitle2: {
      fontSize: '14px',
      fontWeight: 700,
      lineHeight: '21px',
      color: '#333333',
    },
    body1: {
      fontSize: '16px',
      fontWeight: 400,
      lineHeight: '25.6px',
      color: '#333333',
    },
    body2: {
      fontSize: '14px',
      fontWeight: 400,
      lineHeight: '21px',
      color: '#636363',
    },
    button: {
      fontFamily: 'Helvetica, Arial, sans-serif',
      fontSize: '14px',
      fontWeight: 400,
      lineHeight: '20px',
      textTransform: 'none',
    },
  },
  shape: {
    borderRadius: 5,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          boxShadow: 'none',
          borderRadius: 3,
          height: 40,
          padding: '0px 20px',
          fontWeight: 700,
          fontFamily: '"Open Sans", sans-serif',
          transition: 'all 200ms ease',
          '&:focus-visible': {
            outline: '2px solid #030059',
            outlineOffset: 2,
          },
        },
        containedPrimary: {
          backgroundColor: '#A2C6FF',
          color: '#FFFFFF',
          '&:hover': {
            backgroundColor: '#7AADFF',
            boxShadow: 'none',
          },
          '&.Mui-disabled': {
            backgroundColor: '#CCCCCC',
            color: '#636363',
          },
        },
        outlinedPrimary: {
          backgroundColor: 'transparent',
          color: '#030059',
          border: '1px solid #030059',
          fontWeight: 400,
          '&:hover': {
            backgroundColor: 'rgba(162, 198, 255, 0.2)',
            borderColor: '#7AADFF',
          },
          '&:active': {
            backgroundColor: '#A2C6FF',
          },
        },
        textPrimary: {
          backgroundColor: 'transparent',
          color: '#030059',
          fontWeight: 400,
          '&:hover': {
            backgroundColor: 'rgba(162, 198, 255, 0.2)',
          },
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
          padding: 24,
          color: '#333333',
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
          color: '#333333',
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: '#CCCCCC',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: '#7AADFF',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#7AADFF',
            borderWidth: 1,
          },
          '&.Mui-focused': {
            boxShadow: '0px 0px 0px 3px rgba(122, 173, 255, 0.2)',
          },
          '&.Mui-error .MuiOutlinedInput-notchedOutline': {
            borderColor: '#CF2E2E',
          },
        },
        input: {
          padding: '8px 12px',
          '&::placeholder': {
            color: '#636363',
            fontStyle: 'italic',
            opacity: 0.7,
          },
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontFamily: '"Open Sans", sans-serif',
          fontWeight: 700,
          fontSize: 16,
          color: '#333333',
          marginBottom: 8,
          position: 'relative',
          transform: 'none',
          '&.Mui-focused': {
            color: '#030059',
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
          backgroundColor: '#A2C6FF',
          color: '#030059',
        },
        colorError: {
          backgroundColor: '#CF2E2E',
          color: '#FFFFFF',
        },
        colorWarning: {
          backgroundColor: '#FCB900',
          color: '#030059',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#7AADFF',
          color: '#FFFFFF',
          boxShadow: 'none',
        },
      },
    },
    MuiLink: {
      styleOverrides: {
        root: {
          color: '#030059',
          textDecoration: 'underline',
          '&:hover': {
            color: '#7AADFF',
            textDecoration: 'underline dashed',
          },
        },
      },
    },
  },
})

export function ThemeRegistry({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles styles={{
        body: {
          backgroundColor: '#F5F8FF',
          color: '#333333',
          fontFamily: '"Open Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        },
        h1: { color: '#030059', fontWeight: 300 },
        h2: { color: '#030059', fontWeight: 300 },
        h3: { color: '#030059', fontWeight: 400 },
        '.privacy-blur': {
          filter: 'blur(7px)',
          transition: 'filter 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          userSelect: 'none',
          pointerEvents: 'none',
        },
        '.privacy-clear': {
          filter: 'blur(0px)',
          transition: 'filter 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        },
        '.featured-card': {
          backgroundColor: '#A2C6FF',
          color: '#FFFFFF',
          borderRadius: 10,
          padding: 24,
          boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.12)',
        },
        '.info-box': {
          backgroundColor: '#F5F8FF',
          color: '#333333',
          padding: '20px 24px',
          borderRadius: 5,
          border: '1px solid #A2C6FF',
          borderLeft: '4px solid #7AADFF',
        },
      }} />
      {children}
    </ThemeProvider>
  )
}
