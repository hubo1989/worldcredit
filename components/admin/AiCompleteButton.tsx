'use client'

import React, { useState } from 'react'
import { 
  Button, 
  ButtonGroup, 
  CircularProgress, 
  Tooltip, 
  Menu, 
  MenuItem, 
  Checkbox, 
  ListItemText,
  ListItemIcon,
  Box,
  Snackbar,
  Alert
} from '@mui/material'
import { 
  AutoAwesome as AiIcon,
  ArrowDropDown as ArrowDropDownIcon 
} from '@mui/icons-material'
import { aiComplete } from '@/lib/api/ai'

interface AiCompleteButtonProps {
  type: 'bank' | 'card_product'
  formData: Record<string, any>
  onComplete: (completedData: Record<string, any>) => void
  availableFields: { key: string; label: string }[]
}

export default function AiCompleteButton({ 
  type, 
  formData, 
  onComplete, 
  availableFields 
}: AiCompleteButtonProps) {
  const [loading, setLoading] = useState(false)
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  
  const handleOpenMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget)
  }

  const handleCloseMenu = () => {
    setAnchorEl(null)
  }

  const handleAllComplete = async () => {
    if (loading) return
    
    // 基础校验：至少要有名称
    const nameField = type === 'bank' ? 'name' : 'card_name'
    if (!formData[nameField]) {
      alert(`请先填写${type === 'bank' ? '银行' : '卡片'}名称`)
      return
    }

    setLoading(true)
    setErrorMsg(null)
    try {
      const result = await aiComplete({
        type,
        data: formData
      })
      if (!result || Object.keys(result).length === 0) {
        setErrorMsg('AI 未能识别该信息，请尝试补充更多关键词')
        return
      }
      onComplete(result)
    } catch (err: any) {
      console.error('AI Complete Full Error:', err)
      setErrorMsg(err.message || 'AI 补全失败')
    } finally {
      setLoading(false)
    }
  }

  const handleFieldComplete = async (fieldKey: string) => {
    handleCloseMenu()
    setLoading(true)
    setErrorMsg(null)
    try {
      const result = await aiComplete({
        type,
        data: formData,
        fields: [fieldKey]
      })
      onComplete(result)
    } catch (err: any) {
      setErrorMsg(err.message || 'AI 补全失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
      <ButtonGroup variant="contained" size="small" sx={{ 
        bgcolor: '#7c4dff', 
        '&:hover': { bgcolor: '#651fff' } 
      }}>
        <Button
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <AiIcon />}
          onClick={handleAllComplete}
          disabled={loading}
        >
          {loading ? '补全中...' : 'AI 一键补全'}
        </Button>
        <Button
          size="small"
          onClick={handleOpenMenu}
          disabled={loading}
        >
          <ArrowDropDownIcon />
        </Button>
      </ButtonGroup>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleCloseMenu}
        PaperProps={{
          sx: { bgcolor: '#1e2028', color: '#e4e6eb' }
        }}
      >
        <MenuItem disabled sx={{ opacity: 1, fontWeight: 'bold', fontSize: '12px' }}>
          逐项生成
        </MenuItem>
        {availableFields.map((field) => (
          <MenuItem key={field.key} onClick={() => handleFieldComplete(field.key)}>
            <ListItemText primary={field.label} />
          </MenuItem>
        ))}
      </Menu>

      <Snackbar
        open={Boolean(errorMsg)}
        autoHideDuration={6000}
        onClose={() => setErrorMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setErrorMsg(null)} 
          severity="error" 
          variant="filled" 
          sx={{ width: '100%', whiteSpace: 'pre-wrap' }}
        >
          {errorMsg}
        </Alert>
      </Snackbar>
    </Box>
  )
}
