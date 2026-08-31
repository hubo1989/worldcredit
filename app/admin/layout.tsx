import { AdminShell } from '@/components/admin/AdminShell'
import { AdminThemeProvider } from '@/components/admin/AdminThemeProvider'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminThemeProvider>
      <AdminShell>{children}</AdminShell>
    </AdminThemeProvider>
  )
}
