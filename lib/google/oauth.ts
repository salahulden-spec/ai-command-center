export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

/**
 * The redirect URI must exactly match one registered on the Google Cloud
 * OAuth client — using the current page's own origin means it works for
 * both localhost and whatever the deployed domain is, as long as that
 * domain is also registered in Google Cloud Console.
 */
export function googleRedirectUri(): string {
  return `${window.location.origin}/settings`;
}

export function buildGoogleAuthUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
