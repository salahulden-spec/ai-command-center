import { verifyOwnerIdToken } from "@/lib/firebase/verify-id-token";

export async function POST(req: Request) {
  const isOwner = await verifyOwnerIdToken(req.headers.get("authorization"));
  if (!isOwner) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { code, redirectUri }: { code: string; redirectUri: string } = await req.json();

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return Response.json({ error: await tokenRes.text() }, { status: 400 });
  }

  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    return Response.json(
      { error: "Google didn't return a refresh token — try disconnecting in Google Account settings and reconnecting." },
      { status: 400 }
    );
  }

  return Response.json({ refreshToken: tokens.refresh_token, scope: tokens.scope as string });
}
