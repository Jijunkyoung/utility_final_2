import html from '../cloud/static-index';
export function GET() { return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }); }
