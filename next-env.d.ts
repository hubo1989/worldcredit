/// <reference types="vite/client" />

declare module 'next/navigation' {
  export function useRouter(): {
    push: (href: string) => void
    replace: (href: string) => void
    back: () => void
    forward: () => void
    refresh: () => void
  }
  export function usePathname(): string
  export function useSearchParams(): URLSearchParams
  export function useParams<T extends Record<string, string | string[]> = Record<string, string>>(): T
  export function redirect(url: string): never
}

declare module 'next/link' {
  import { ComponentType, AnchorHTMLAttributes, ReactNode } from 'react'
  export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
    href: string
    replace?: boolean
    scroll?: boolean
    prefetch?: boolean
    children?: ReactNode
  }
  const Link: ComponentType<LinkProps>
  export default Link
}

declare module 'next' {
  export type Metadata = Record<string, any>
  export type Viewport = Record<string, any>
}
