'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/obsidian/controls'
import { Alert } from '@/components/obsidian/feedback'
import {
  PaperclipIcon,
  TrashIcon,
  FileIcon,
  OpenInNewIcon,
  UploadIcon,
} from '@/components/icons/WcIcon'
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
    <div>
      <div className='mb-3 flex items-center justify-between'>
        <div className='flex items-center gap-1.5'>
          <PaperclipIcon size={20} className='text-d-text' />
          <p className='text-[19px] font-semibold leading-6 text-d-text'>附件</p>
        </div>
        <Button
          variant='secondary'
          size='sm'
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? '上传中' : <><UploadIcon size={16} /> 上传文件</>}
        </Button>
      </div>

      <input ref={inputRef} type='file' hidden onChange={handleFileChange} />

      {/* 错误提示条：语义状态容器，保留语义色描边 */}
      {error && <div className='mb-3'><Alert severity='error'>{error}</Alert></div>}

      {loading ? (
        <p className='text-[14px] leading-5 text-d-muted'>正在加载附件...</p>
      ) : attachments.length === 0 ? (
        <p className='text-[14px] leading-5 text-d-muted'>
          暂无附件，可上传账单 PDF、截图或邮件原文。
        </p>
      ) : (
        <div className='flex flex-col gap-2'>
          {attachments.map(attachment => {
            const url = getAttachmentUrl(attachment)
            return (
              <div
                key={attachment.id}
                className='flex items-center gap-2.5 rounded-xl border border-d-border bg-d-surface p-2.5'
              >
                <FileIcon size={20} className='shrink-0 text-d-text' />
                <div className='min-w-0 flex-1'>
                  <a
                    href={url}
                    target='_blank'
                    rel='noreferrer'
                    className='block text-[14px] font-semibold leading-5 text-d-accent-light [overflow-wrap:anywhere] hover:underline'
                  >
                    {attachment.file_name}
                  </a>
                  <p className='text-[13px] leading-4 text-d-muted'>
                    {[attachment.file_type, formatFileSize(attachment.file_size)].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <a
                  href={url}
                  target='_blank'
                  rel='noreferrer'
                  aria-label='打开附件'
                  className='shrink-0 rounded-full p-1.5 text-d-muted transition-colors hover:text-d-text'
                >
                  <OpenInNewIcon size={16} />
                </a>
                <button
                  type='button'
                  onClick={() => handleDelete(attachment)}
                  aria-label='删除附件'
                  className='shrink-0 rounded-full p-1.5 text-d-danger-ink transition-colors hover:text-d-danger'
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
