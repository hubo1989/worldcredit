import { readCookie } from "./lib/cookies";
import { SESSION_COOKIE, verifySessionValue } from "./lib/session";

export async function proxy(request: Request): Promise<Response | undefined> {
  const { pathname } = new URL(request.url);
  // Keep this guard scoped to the landing page even if the matcher changes later.
  if (pathname !== "/") return undefined;

  const session = await verifySessionValue(
    readCookie(request.headers.get("cookie"), SESSION_COOKIE),
  );
  if (!session) return undefined;

  return Response.redirect(new URL("/dashboard", request.url), 307);
}

export const config = {
  matcher: "/",
};

export default proxy;
