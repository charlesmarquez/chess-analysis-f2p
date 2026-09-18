export const ENGINE_URL = "https://cdn.jsdelivr.net/npm/stockfish@11.0.0/src/stockfish.asm.js";

export async function initEngine() {
  const resp = await fetch(ENGINE_URL);
  if (!resp.ok) throw new Error('engine fetch failed: HTTP ' + resp.status);
  const blob = await resp.blob();
  const blobUrl = URL.createObjectURL(blob);
  const worker = new Worker(blobUrl);

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('engine did not respond to uci')), 20000);
    const onMsg = (e) => {
      if (typeof e.data === 'string' && e.data.includes('uciok')) {
        clearTimeout(timeout);
        worker.removeEventListener('message', onMsg);
        resolve();
      }
    };
    worker.addEventListener('message', onMsg);
    worker.onerror = (e) => { clearTimeout(timeout); reject(new Error('worker error: ' + e.message)); };
    worker.postMessage('uci');
  });

  return worker;
}

// Runs "go depth D" at a FEN; resolves with { cp, mate, pv: [uciMove, ...] }
export function evaluate(worker, fen, depth) {
  return new Promise((resolve) => {
    let best = { cp: 0, mate: null, pv: [] };
    const onMsg = (e) => {
      const line = e.data;
      if (typeof line !== 'string') return;
      if (line.startsWith('info') && line.includes(' pv ')) {
        const cpMatch = line.match(/score cp (-?\d+)/);
        const mateMatch = line.match(/score mate (-?\d+)/);
        const pvMatch = line.match(/ pv (.+)$/);
        if (pvMatch) {
          best = {
            cp: cpMatch ? parseInt(cpMatch[1], 10) : null,
            mate: mateMatch ? parseInt(mateMatch[1], 10) : null,
            pv: pvMatch[1].trim().split(/\s+/)
          };
        }
      } else if (line.startsWith('bestmove')) {
        worker.removeEventListener('message', onMsg);
        resolve(best);
      }
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage('position fen ' + fen);
    worker.postMessage('go depth ' + depth);
  });
}
