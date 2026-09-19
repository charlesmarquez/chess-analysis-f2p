// Resolves a chess.com game share link (any of /game/184..., /game/live/184...,
// /game/daily/184..., /analysis/game/live/184...?...) to a full PGN.
//
// There's no public "get game by ID" endpoint. The undocumented
// chess.com/callback/live|daily/game/{id} endpoint has the game but encodes moves in
// chess.com's own compact format (not SAN) and isn't worth reverse-engineering — instead
// we use it only to learn the players' usernames + date, then pull the actual PGN from
// the official, stable, CORS-open api.chess.com/pub player-archive endpoint. Both calls
// happen server-side because the callback endpoint sends no CORS header.

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};

function extractGameId(url) {
  const m = String(url).match(/game\/(?:live\/|daily\/)?(\d+)/) || String(url).match(/(\d{6,})/);
  return m ? m[1] : null;
}

async function fetchCallbackGame(id) {
  for (const kind of ['live', 'daily']) {
    const resp = await fetch(`https://www.chess.com/callback/${kind}/game/${id}`, { headers: BROWSER_HEADERS });
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.game) return data.game;
    }
  }
  return null;
}

async function findPgnInArchive(username, year, month, id) {
  const resp = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/${year}/${month}`, {
    headers: BROWSER_HEADERS
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const game = (data.games || []).find(g => (g.url || '').includes(id));
  return game ? game.pgn : null;
}

export default async function handler(req, res) {
  const url = req.method === 'GET' ? req.query.url : (req.body || {}).url;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  const id = extractGameId(url);
  if (!id) return res.status(400).json({ error: 'Could not find a game ID in that link.' });

  try {
    const game = await fetchCallbackGame(id);
    if (!game || !game.pgnHeaders) {
      return res.status(404).json({ error: 'Chess.com has no game with that ID (or it is private).' });
    }

    const [year, month] = (game.pgnHeaders.Date || '').split('.');
    if (!year || !month) return res.status(502).json({ error: 'Unexpected response from chess.com — missing game date.' });

    const candidates = [game.pgnHeaders.White, game.pgnHeaders.Black].filter(Boolean);
    for (const username of candidates) {
      const pgn = await findPgnInArchive(username, year, month, id);
      if (pgn) return res.status(200).json({ pgn });
    }

    return res.status(404).json({ error: "Found the game, but couldn't locate its PGN in either player's public archive (account may be private)." });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch from chess.com: ' + String(err) });
  }
}
