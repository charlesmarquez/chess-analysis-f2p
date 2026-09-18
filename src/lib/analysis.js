import { Chess } from 'chess.js';

export const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const TAG_LABEL = {
  brilliant: 'Brilliant !!', best: 'Best', good: 'Good',
  inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder'
};

export function scoreToCp(res) {
  if (res.mate !== null && res.mate !== undefined) {
    const sign = res.mate > 0 ? 1 : -1;
    return sign * (100000 - Math.abs(res.mate) * 100);
  }
  return res.cp || 0;
}

export function materialDiff(fen) {
  const board = fen.split(' ')[0];
  let diff = 0;
  for (const ch of board) {
    if (/[a-zA-Z]/.test(ch)) {
      const v = PIECE_VALUES[ch.toLowerCase()] || 0;
      diff += (ch === ch.toUpperCase()) ? v : -v;
    }
  }
  return diff; // + = White ahead
}

export function classify(cpLoss, isSac) {
  if (isSac && cpLoss <= 40) return 'brilliant';
  if (cpLoss <= 10) return 'best';
  if (cpLoss <= 60) return 'good';
  if (cpLoss <= 150) return 'inaccuracy';
  if (cpLoss <= 300) return 'mistake';
  return 'blunder';
}

export function fmtEval(res, whiteToMove) {
  if (res.mate !== null && res.mate !== undefined) {
    const m = whiteToMove ? res.mate : -res.mate;
    return (m > 0 ? '#' + m : '#-' + Math.abs(m));
  }
  const white = whiteToMove ? res.cp : -res.cp;
  return (white / 100).toFixed(2);
}

export function parseGame(pgnText) {
  const game = new Chess();
  const ok = game.load_pgn(pgnText, { sloppy: true });
  if (!ok) throw new Error('Could not parse PGN — check the move list.');
  const moves = game.history({ verbose: true });
  const replay = new Chess();
  const positions = [replay.fen()];
  const sanList = [];
  for (const m of moves) {
    replay.move(m.san, { sloppy: true });
    positions.push(replay.fen());
    sanList.push(m.san);
  }
  return { positions, sanList };
}

// Approximate sacrifice detector: engine's own main line, right after the played
// move, lets the opponent capture a minor+ piece; material genuinely drops for the
// mover; the position wasn't already decisive; and the mover isn't left worse off.
export function detectSacrifice({ positions, i, moverIsWhite, evalBefore, evalAfterForMover, replyPv }) {
  if (!replyPv || replyPv.length < 4) return false;
  try {
    const tmp = new Chess(positions[i + 1]);
    const mv = tmp.move({
      from: replyPv.slice(0, 2),
      to: replyPv.slice(2, 4),
      promotion: replyPv.length > 4 ? replyPv.slice(4, 5) : undefined
    });
    if (!mv || !mv.captured || PIECE_VALUES[mv.captured] < 3) return false;

    const moverMaterialBefore = moverIsWhite ? materialDiff(positions[i]) : -materialDiff(positions[i]);
    const moverMaterialAfterReply = moverIsWhite ? materialDiff(tmp.fen()) : -materialDiff(tmp.fen());
    const materialDrop = moverMaterialBefore - moverMaterialAfterReply;
    const notAlreadyWinning = Math.abs(evalBefore) < 500;
    const stillOkAfter = evalAfterForMover >= -60;
    return materialDrop >= 3 && notAlreadyWinning && stillOkAfter;
  } catch {
    return false;
  }
}
