// Fixed secret shared by the page-VR Playwright config (webServer env) and the
// session-cookie generator, so the next-auth JWT we mint is decodable by both
// the running app's /api/auth/session route and the proxy.js middleware.
// Test-only — never used by the real app.
export const VR_SECRET = 'vr-visual-regression-secret-not-used-in-production-0000';
export const VR_PORT = 4321;
export const VR_BASE = `http://localhost:${VR_PORT}`;
