'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Link,
  Stack,
  Typography,
} from '@mui/material'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import FileIcon from '@mui/icons-material/InsertDriveFile'
import OpenIcon from '@mui/icons-material/OpenInNew'
import UploadIcon from '@mui/icons-material/UploadFile'
import { useAuth } from '@/lib/auth'
import {
  deleteRecordAttachment,
  getAttachmentUrl,
  getAttachments,
  uploadRecordAttachment,
  type RecordAttachment,
} from '@/lib/api/attachments'

interface Props {
  billId: string
  onChanged?: () => void
}

function formatFileSize(size?: number): string {
  if (!size) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

// MUI Typography/Link 自带样式注入在 globals.css 之后，同特异性下角色 class 会被覆盖，
// 因此排版令牌直接写进 sx。
const BODY = {
  fontSize: 'var(--type-body-size)',
  lineHeight: 'var(--type-body-line)',
  fontWeight: 'var(--type-body-weight)',
  letterSpacing: 'var(--type-body-tracking)',
}
const SECTION = {
  fontSize: 'var(--type-section-size)',
  lineHeight: 'var(--type-section-line)',
  fontWeight: 'var(--type-section-weight)',
  letterSpacing: 'var(--type-section-tracking)',
}

export function BillAttachments({ billId, onChanged }: Props) {
  const { user } = useAuth()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [attachments, setAttachments] = useState<RecordAttachment[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setAttachments(await getAttachments('bill', billId))
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载附件失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billId])

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setUploading(true)
    setError(null)
    try {
      await uploadRecordAttachment('bill', billId, file, user?.id)
      await load()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (attachment: RecordAttachment) => {
    setError(null)
    try {
      await deleteRecordAttachment(attachment)
      await load()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <AttachFileIcon sx={{ fontSize: 20, color: 'var(--strong)' }} />
          <Typography sx={{ ...SECTION, color: 'var(--text)' }}>
            附件
          </Typography>
        </Stack>
        <Button
          size="small"
          variant="outlined"
          startIcon={uploading ? <CircularProgress size={14} /> : <UploadIcon />}
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          sx={{
            // 无可见边框：层级由分层阴影表达
            border: 0,
            bgcolor: 'var(--paper)',
            boxShadow: 'var(--shadow-e1)',
            borderRadius: 'var(--radius-pill)',
            '&:hover': { border: 0, boxShadow: 'var(--shadow-e2)' },
          }}
        >
          {uploading ? '上传中' : '上传文件'}
        </Button>
      </Stack>

      <input ref={inputRef} type="file" hidden onChange={handleFileChange} />

      {/* 错误提示条：语义状态容器，保留 1px 语义色描边 */}
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

      {loading ? (
        <Typography sx={{ ...BODY, color: 'var(--muted)' }}>正在加载附件...</Typography>
      ) : attachments.length === 0 ? (
        <Typography sx={{ ...BODY, color: 'var(--muted)' }}>
          暂无附件，可上传账单 PDF、截图或邮件原文。
        </Typography>
      ) : (
        <Stack spacing={1}>
          {attachments.map(attachment => {
            const url = getAttachmentUrl(attachment)
            return (
              <Box
                key={attachment.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 1,
                  // 列表行：无边框 + 分层阴影，圆角走 12px 档
                  border: 0,
                  borderRadius: 'var(--radius-depth-1)',
                  bgcolor: 'var(--paper)',
                  boxShadow: 'var(--shadow-e1)',
                }}
              >
                <FileIcon sx={{ fontSize: 20, color: 'var(--strong)' }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Link
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    underline="hover"
                    sx={{ ...BODY, fontWeight: 600, wordBreak: 'break-all' }}
                  >
                    {attachment.file_name}
                  </Link>
                  <Typography sx={{ ...BODY, color: 'var(--muted)', display: 'block' }}>
                    {[attachment.file_type, formatFileSize(attachment.file_size)].filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
                <IconButton
                  size="small"
                  component="a"
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="打开附件"
                  sx={{ color: 'var(--strong)' }}
                >
                  <OpenIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" color="error" onClick={() => handleDelete(attachment)} aria-label="删除附件">
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            )
          })}
        </Stack>
      )}
    </Box>
  )
}
