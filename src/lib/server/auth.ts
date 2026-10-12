import { createHash, timingSafeEqual } from "node:crypto";

// Optional lock: set APP_PASSWORD in Vercel and the app asks for it once per device.
// Without it, anyone who has the link can use the stylist (and your Claude credits).

export function passwordRequired(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

export function authorized(req: Request): boolean {
  const want = process.env.APP_PASSWORD;
  if (!want) return true;
  const got = req.headers.get("x-shopr-password") ?? "";
  const a = createHash("sha256").update(want).digest();
  const b = createHash("sha256").update(got).digest();
  return timingSafeEqual(a, b);
}

export function unauthorized(): Response {
  return Response.json({ error: "password", message: "This shopr is private. Enter the password." }, { status: 401 });
}
