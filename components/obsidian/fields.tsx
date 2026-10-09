'use client'

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { ChevronDownIcon } from '@/components/icons/WcIcon'

// ObsidianUI 表单控件：原生 input / select / textarea + d-* token。
// 触控高度 44px（h-11）；输入字号 16px 防 iOS 聚焦缩放。

const FIELD_FONT = 'text-[16px] leading-[22px]'

function FieldShell({
  label,
  required,
  error,
  helperText,
  htmlFor,
  containerClassName,
  children,
}: {
  label?: ReactNode
  required?: boolean
  error?: boolean
  helperText?: ReactNode
  htmlFor?: string
  /** 整个字段（label + 控件 + helper）的外层类，如 flex 行内的宽度控制 */
  containerClassName?: string
  children: ReactNode
}) {
  return (
    <div className={'w-full ' + (containerClassName ?? '')}>
      {label ? (
        <label htmlFor={htmlFor} className='mb-1.5 block text-[13px] font-semibold leading-5 text-d-muted'>
          {label}
          {required ? <span className='ml-0.5 text-d-danger'>*</span> : null}
        </label>
      ) : null}
      {children}
      {error && helperText ? (
        <p className='mt-1.5 text-[12px] leading-4 text-d-danger-ink'>{helperText}</p>
      ) : helperText ? (
        <p className='mt-1.5 text-[12px] leading-4 text-d-muted'>{helperText}</p>
      ) : null}
    </div>
  )
}

const CONTROL_CLS =
  'w-full rounded-xl border bg-d-surface px-3.5 text-d-text outline-none transition-colors ' +
  'placeholder:text-d-muted/60 focus:border-d-accent focus:ring-2 focus:ring-d-accent/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  label?: ReactNode
  error?: boolean
  helperText?: ReactNode
  /** 输入框内前缀图标/文本 */
  startAdornment?: ReactNode
  /** 输入框内后缀（单位、眼睛开关等） */
  endAdornment?: ReactNode
  /** 整个字段（label + 控件 + helper）的外层类 */
  containerClassName?: string
}

export function TextField({
  label,
  error,
  helperText,
  startAdornment,
  endAdornment,
  containerClassName,
  id,
  required,
  ...input
}: TextFieldProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const border = error ? 'border-d-danger' : 'border-d-border'
  return (
    <FieldShell label={label} required={required} error={error} helperText={helperText} htmlFor={inputId} containerClassName={containerClassName}>
      <div className='relative'>
        {startAdornment ? (
          <span className='pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-d-muted'>
            {startAdornment}
          </span>
        ) : null}
        <input
          id={inputId}
          required={required}
          className={[
            CONTROL_CLS,
            FIELD_FONT,
            'h-11',
            border,
            startAdornment ? 'pl-10' : '',
            endAdornment ? 'pr-10' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          {...input}
        />
        {endAdornment ? (
          <span className='absolute right-3 top-1/2 -translate-y-1/2 text-d-muted'>{endAdornment}</span>
        ) : null}
      </div>
    </FieldShell>
  )
}

type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & {
  label?: ReactNode
  error?: boolean
  helperText?: ReactNode
  /** 整个字段（label + 控件 + helper）的外层类 */
  containerClassName?: string
}

export function TextArea({ label, error, helperText, containerClassName, id, required, ...area }: TextAreaProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <FieldShell label={label} required={required} error={error} helperText={helperText} htmlFor={inputId} containerClassName={containerClassName}>
      <textarea
        id={inputId}
        required={required}
        className={[CONTROL_CLS, FIELD_FONT, 'min-h-[88px] py-2.5', error ? 'border-d-danger' : 'border-d-border']
          .filter(Boolean)
          .join(' ')}
        {...area}
      />
    </FieldShell>
  )
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'children'> & {
  label?: ReactNode
  error?: boolean
  helperText?: ReactNode
  options: { value: string; label: string; disabled?: boolean }[]
  /** 顶部占位项（等价 MUI Select 的 placeholder），值取 '' */
  placeholder?: string
  /** 整个字段（label + 控件 + helper）的外层类 */
  containerClassName?: string
}

export function SelectField({
  label,
  error,
  helperText,
  options,
  placeholder,
  containerClassName,
  id,
  required,
  ...select
}: SelectFieldProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <FieldShell label={label} required={required} error={error} helperText={helperText} htmlFor={inputId} containerClassName={containerClassName}>
      <div className='relative'>
        <select
          id={inputId}
          required={required}
          className={[
            CONTROL_CLS,
            FIELD_FONT,
            'h-11 appearance-none pr-9',
            error ? 'border-d-danger' : 'border-d-border',
            select.value === '' || select.value == null ? 'text-d-muted' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          {...select}
        >
          {placeholder !== undefined ? (
            <option value='' disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon size={18} className='pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-d-muted' />
      </div>
    </FieldShell>
  )
}
