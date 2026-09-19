import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `vite dev` doesn't run Vercel serverless functions (only `vercel dev` or a real
// deploy does), so /api/chess-com-game would 404 locally without this — it wraps the
// same handler Vercel calls in production, translating Vite's (req, res) into the
// (req.query, res.status().json()) shape the handler expects.
function chessComApiDevMiddleware() {
  return {
    name: 'chess-com-api-dev-middleware',
    configureServer(server) {
      server.middlewares.use('/api/chess-com-game', async (req, res) => {
        const { default: handler } = await server.ssrLoadModule('/api/chess-com-game.js');
        const query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
        await handler({ method: 'GET', query }, {
          status(code) { res.statusCode = code; return this; },
          json(obj) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); }
        });
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), chessComApiDevMiddleware()]
})
