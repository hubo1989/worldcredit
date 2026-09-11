import { readSession } from '@/lib/session'

export async function GET(request: Request) {
  const user = await readSession(request)
  return Response.json({ user })
}
