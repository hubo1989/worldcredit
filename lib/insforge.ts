// lib/insforge.ts
import { createClient } from '@insforge/sdk'

const insforgeUrl = process.env.NEXT_PUBLIC_INSFORGE_URL!
const insforgeKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!

// 注意：如果 baseUrl 没配置，它会默认指向 http://localhost:7130
export const insforge = createClient({
  baseUrl: insforgeUrl,
  anonKey: insforgeKey,
})

export default insforge
