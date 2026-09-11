export async function GET(request: Request) {
  const cookies = request.headers.get('Cookie') || ''
  const match = cookies.match(/wc_user=([^;]+)/)
  if (!match) {
    return Response.json({ user: null })
  }
  try {
    const user = JSON.parse(decodeURIComponent(match[1]))
    return Response.json({ user })
  } catch {
    return Response.json({ user: null })
  }
}
