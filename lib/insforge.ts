import { createClient } from '@insforge/sdk'

const insforgeUrl = process.env.NEXT_PUBLIC_INSFORGE_URL
const insforgeKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY

if (!insforgeUrl || !insforgeKey) {
  throw new Error('Missing InsForge environment variables: NEXT_PUBLIC_INSFORGE_URL or NEXT_PUBLIC_INSFORGE_ANON_KEY')
}

export const insforge = createClient({
  baseUrl: insforgeUrl,
  anonKey: insforgeKey
})

export const db = insforge.database
