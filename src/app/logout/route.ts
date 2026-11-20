// GET may be requested by link prefetching; it must never invalidate a session.
export function GET() {
  return new Response(null, {
    status: 307,
    headers: { Location: "/", "Cache-Control": "no-store" },
  });
}
