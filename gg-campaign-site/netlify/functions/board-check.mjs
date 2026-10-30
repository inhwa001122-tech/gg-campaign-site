// Temporary, non-sensitive diagnostic for the public board deployment.
// This function never returns the secret, any part of it, or its length.
export default async function handler() {
  const value = process.env.BOARD_ADMIN_SECRET;
  return new Response(JSON.stringify({
    functionReady: true,
    production: process.env.CONTEXT === 'production',
    secretAvailable: typeof value === 'string' && value.length > 0,
    secretMeetsMinimum: typeof value === 'string' && value.length >= 12
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
