import { Chess } from 'chess.js';

export const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const TAG_LABEL = {
  brilliant: 'Brilliant !!', best: 'Best', good: 'Good', miss: 'Miss',
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

// scoreToCp encodes a forced mate as ~100000 minus a small multiple of the mate
// distance, so any real mate score stays far above ordinary evals (which never get
// remotely close even in a totally lost position) — a safe way to tell "still a
// forced mate" apart from "just a big material/positional edge" using cp alone.
const MATE_SCALE_THRESHOLD = 50000;

// Smoothly-decaying centipawn tolerance for the opening (tapering to 0 by roughly
// move 10 for both sides), rather than a hard cutoff. Shallow-depth search disagrees
// by this much between adjacent, equally-reasonable theory/development moves — without
// it, ordinary opening play gets flagged as a real error purely from search noise. A
// hard cliff (full bonus, then none) is worse: it draws an arbitrary line exactly
// where "opening" ambiguously ends, so a move one ply past it loses all leniency at
// once. Applied to every tier (not just inaccuracy+), since the same noise pushes
// perfectly fine moves out of Best/Good too.
const OPENING_PLIES = 20;
const OPENING_MAX_BONUS = 60;
function openingLeniency(ply) {
  if (ply >= OPENING_PLIES) return 0;
  return Math.round(OPENING_MAX_BONUS * (1 - ply / OPENING_PLIES));
}

// Mover let a real advantage slip without the position actually turning bad for
// them — a missed knockout blow rather than a genuine error. Two distinct cases:
//  - Had a forced mate and it's now GONE entirely (not just slower) — dropping from
//    "mate in 3" to "mate in 5" isn't a meaningful mistake (both are already dead
//    lost for the opponent) and shouldn't be flagged every single time the mover
//    takes a less-than-fastest path; only losing the forced mate altogether counts.
//  - Had a clear-but-not-yet-crushing edge (400-1000cp, no mate on the board) and
//    let most of it slip. The upper cp bound matters: past ~1000cp the game is so
//    lopsided that nearly every non-best move would otherwise qualify, flooding a
//    decided endgame with Misses instead of flagging the one real missed conversion.
export function detectMiss({ evalBefore, mateBefore, evalAfterForMover, cpLoss }) {
  const hadMate = mateBefore !== null && mateBefore !== undefined && mateBefore > 0;
  if (hadMate) {
    const stillMate = evalAfterForMover >= MATE_SCALE_THRESHOLD;
    return !stillMate && evalAfterForMover >= -50;
  }
  const missedBigEdge = evalBefore >= 400 && evalBefore < 1000 && cpLoss >= 200;
  return missedBigEdge && evalAfterForMover >= -50;
}

export function classify(cpLoss, isSac, ctx = {}) {
  const { ply = Infinity, isMiss = false } = ctx;
  if (isSac && cpLoss <= 40) return 'brilliant';
  if (isMiss) return 'miss';
  const lenient = openingLeniency(ply);
  if (cpLoss <= 15 + lenient) return 'best';
  if (cpLoss <= 80 + lenient) return 'good';
  if (cpLoss <= 180 + lenient) return 'inaccuracy';
  if (cpLoss <= 350 + lenient) return 'mistake';
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

// Converts an engine result (relative to the side to move) into White's perspective.
export function whiteEvalOf(res, whiteToMove) {
  if (res.mate !== null && res.mate !== undefined) {
    return { cp: null, mate: whiteToMove ? res.mate : -res.mate };
  }
  return { cp: whiteToMove ? (res.cp || 0) : -(res.cp || 0), mate: null };
}

export function parseUciMove(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci.slice(4, 5) : undefined };
}

// Given a FEN and a UCI-style PV (e.g. ['e2e4','e7e5',...]), replays it and returns
// the resulting FEN after each move plus the chess.js verbose move objects (from/to/
// flags/color/captured/san/...), stopping early if a move in the PV turns out illegal.
// fens has one more entry than moves: fens[0] is the starting position.
export function pvToLine(fen, pv) {
  const tmp = new Chess(fen);
  const fens = [tmp.fen()];
  const moves = [];
  for (const uci of pv) {
    const mv = tmp.move(parseUciMove(uci));
    if (!mv) break;
    moves.push(mv);
    fens.push(tmp.fen());
  }
  return { fens, moves };
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
  return { positions, sanList, moves };
}

// Approximate sacrifice detector: engine's own main line, right after the played
// move, lets the opponent capture a minor+ piece; material genuinely drops for the
// mover; the position wasn't already decisive; and the mover isn't left worse off.
export function detectSacrifice({ positions, i, moverIsWhite, evalBefore, evalAfterForMover, replyPv }) {
  if (!replyPv || replyPv.length < 4) return false;
  try {
    const tmp = new Chess(positions[i + 1]);
    const mv = tmp.move(parseUciMove(replyPv));
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
