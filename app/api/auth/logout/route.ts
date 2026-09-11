export async function POST() {
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': 'wc_user=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' } }
  )
}
