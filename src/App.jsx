import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { initEngine, evaluate } from './lib/engine.js';
import { parseGame, scoreToCp, fmtEval, classify, detectSacrifice, detectMiss, whiteEvalOf, parseUciMove, pvToLine, TAG_LABEL } from './lib/analysis.js';
import Chessboard from './components/Chessboard.jsx';
import EvalBar from './components/EvalBar.jsx';

// In a mate PV, whichever side is to move at ply 0 delivers the mate; that side's
// moves are the ones a solver practices, alternating with the defender's forced
// replies. startsWithUser is true when the practiced (mating) side moves first.
function isUsersTurn(idx, startsWithUser) {
  return startsWithUser ? idx % 2 === 0 : idx % 2 === 1;
}

const ROW_CLASS = {
  brilliant: 'flagged', best: '', good: '', inaccuracy: 'bad', mistake: 'bad', blunder: 'worse', miss: 'bad'
};

// Move classes annotated with an on-board badge (chess.com marks these near the
// moved-to square); good/inaccuracy stay text-only in the move list to avoid noise.
const BADGE_CLASSES = ['brilliant', 'best', 'mistake', 'blunder', 'miss'];

function movePairs(rows) {
  const pairs = [];
  for (const r of rows) {
    const i = r.moveNo - 1;
    if (!pairs[i]) pairs[i] = { moveNo: r.moveNo };
    pairs[i][r.moverIsWhite ? 'white' : 'black'] = r;
  }
  return pairs;
}

function MoveCell({ row, active, onSelect, onPlayMate, onPracticeMate, busyWithMate }) {
  if (!row) return <div className="move-cell empty" />;
  return (
    <div
      className={'move-cell ' + ROW_CLASS[row.cls] + (active ? ' active' : '')}
      title={`${row.evalBeforeDisplay} → ${row.evalAfterDisplay}`}
      onClick={() => onSelect(row.idx + 1)}
    >
      <span className="move-san">{row.san}</span><span className={'move-tag tag-' + row.cls}>{TAG_LABEL[row.cls]}</span>
      {row.mateIn && <span className="mate-flag" title={`Forced mate in ${row.mateIn}`}>#{row.mateIn}</span>}
      {row.mateIn && (
        <button
          className="mate-play-btn"
          title={`Play out the forced mate in ${row.mateIn} on the board`}
          disabled={busyWithMate}
          onClick={e => { e.stopPropagation(); onPlayMate(row); }}
        >
          ▶
        </button>
      )}
      {row.mateIn && (
        <button
          className="mate-play-btn practice-btn"
          title={`Practice finding the forced mate in ${row.mateIn}`}
          disabled={busyWithMate}
          onClick={e => { e.stopPropagation(); onPracticeMate(row); }}
        >
          🎯
        </button>
      )}
    </div>
  );
}

const SAMPLE_PGN = `1. h3 e5 2. Nf3 Nc6 3. e4 Bc5 4. Bc4 d6 5. Bd5 Nd4 6. Nxd4 exd4 7. d3 Nf6 8. Bg5
h6 9. Bxf6 gxf6 10. Qg4 Bxg4 11. hxg4 c6 12. Bc4 Qc7 13. O-O O-O-O 14. Nd2 d5
15. exd5 cxd5 16. Bb3 Bb4 17. Nf3 h5 18. g5 fxg5 19. Nxg5 Rhf8 20. a3 Be7 21.
Nh3 Qe5 22. Rae1 Qd6 23. f4 a5 24. f5 f6 25. c4 dxc4 26. Bxc4 a4 27. Be6+ Kb8
28. Bc4 Qb6 29. Rxe7 Qxb2 30. Nf4 Qxa3 31. Ng6 Qc5 32. Nxf8 Qxe7 33. Ng6 Qc5 34.
Be6 a3 35. Ra1 Qc3 36. Ne5 Qxa1+ 37. Kh2 Qb2 38. Nf7 Rg8 39. Bd5 a2 40. Nh6 a1=Q
41. Nxg8 Qa5 42. Be4 Qe1 43. Nxf6 h4 44. Nd7+ Kc7 45. Nc5 Qg3+ 46. Kg1 Qb1#`;

export default function App() {
  const [pgn, setPgn] = useState(SAMPLE_PGN);
  const [chessComUrl, setChessComUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [depth, setDepth] = useState(12);
  const [status, setStatus] = useState('Ready. Click "Analyze game" to load the engine and begin.');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState(null);
  const [positions, setPositions] = useState([]);
  const [boardIndex, setBoardIndex] = useState(0);
  const [currentEval, setCurrentEval] = useState({ cp: 0, mate: null });
  const [showArrow, setShowArrow] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [animatingMove, setAnimatingMove] = useState(null);
  const [previewStep, setPreviewStep] = useState(-1); // -1 = not previewing a mate line
  const [previewLine, setPreviewLine] = useState(null); // { fens, moves } for whichever line is playing
  const [practice, setPractice] = useState(null); // see startPractice() for shape, null when inactive

  const engineRef = useRef(null);
  const stopRef = useRef(false);
  const movesRef = useRef([]);
  const evalsRef = useRef([]);
  const boardIndexRef = useRef(0);
  const movelistRef = useRef(null);
  const previewTimerRef = useRef(null);
  // Squares whose piece was ever restored by an undone capture. Kept permanently (not
  // just for the duration of that one animation) — see the key-collision note in
  // Chessboard.jsx for why letting it revert to a plain default key is unsafe.
  const revealedSquaresRef = useRef(new Set());

  useEffect(() => () => clearInterval(previewTimerRef.current), []);

  useEffect(() => {
    const res = evalsRef.current[boardIndex];
    if (res) setCurrentEval(whiteEvalOf(res, boardIndex % 2 === 0));
  }, [boardIndex]);

  // Keeps the analysis move list scrolled to whichever move the board is
  // currently showing, so stepping through with arrow keys/nav buttons doesn't
  // require manually scrolling the (often much longer) move list to follow along.
  useEffect(() => {
    const active = movelistRef.current?.querySelector('.move-cell.active');
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [boardIndex]);

  // Auto-clears the sliding-piece animation once its CSS transition has finished.
  useEffect(() => {
    if (!animatingMove) return;
    const t = setTimeout(() => setAnimatingMove(null), 220);
    return () => clearTimeout(t);
  }, [animatingMove]);

  // Tracks the boardIndex that's actually been committed/rendered — deliberately NOT
  // updated eagerly inside goToIndex. If moves are requested faster than React can
  // render them (rapid clicks/key-repeat), several goToIndex calls can land in the
  // same batch; only the last one's state actually reaches the screen. Reading this
  // ref (rather than an eagerly-mutated one) means that last call still measures its
  // delta against what's really on screen, correctly detects a multi-step jump, and
  // falls back to a snap — instead of animating a single piece with a stale/mismatched
  // from-square, which is what left the leftover "ghost" piece images during fast
  // navigation.
  useLayoutEffect(() => {
    boardIndexRef.current = boardIndex;
  }, [boardIndex]);

  // Sliding-piece animation for playing `move` forward — shared by goToIndex's
  // forward case and the mate-sequence preview, which only ever steps forward.
  function forwardAnim(move) {
    const anim = { pieceFrom: move.from, pieceTo: move.to };
    if (move.flags.includes('k') || move.flags.includes('q')) {
      const rank = move.color === 'w' ? '1' : '8';
      anim.rookFrom = (move.flags.includes('k') ? 'h' : 'a') + rank;
      anim.rookTo = (move.flags.includes('k') ? 'f' : 'd') + rank;
    }
    return anim;
  }

  // Navigates the board. For a single-step move (the common "stepping through
  // moves" case) this also computes the sliding-piece animation and applies it
  // in the SAME state update as the index change, so Chessboard's very first
  // render of the new position already carries the right animation info —
  // computing it a tick later (e.g. in a useEffect keyed on boardIndex) is too
  // late: the piece would already have snapped to its new square by then.
  function goToIndex(newIndexRaw) {
    stopMatePreview();
    stopPractice();
    const newIndex = Math.max(0, Math.min(positions.length - 1, newIndexRaw));
    const prev = boardIndexRef.current;
    const delta = newIndex - prev;

    let anim = null;
    if (Math.abs(delta) === 1) {
      const forward = delta === 1;
      const move = movesRef.current[forward ? prev : newIndex];
      if (move) {
        anim = forward
          ? forwardAnim(move)
          : { pieceFrom: move.to, pieceTo: move.from };
        if (!forward && (move.flags.includes('k') || move.flags.includes('q'))) {
          const rank = move.color === 'w' ? '1' : '8';
          anim.rookFrom = (move.flags.includes('k') ? 'f' : 'd') + rank;
          anim.rookTo = (move.flags.includes('k') ? 'h' : 'a') + rank;
        }
        // Undoing a (non-en-passant) capture brings the captured piece back onto
        // move.to — the same square the retreating piece is keyed by (its pre-undo
        // square). Without flagging it, both pieces would compute the identical
        // key and collide.
        if (!forward && move.captured && !move.flags.includes('e')) {
          anim.revealedSquare = move.to;
          revealedSquaresRef.current.add(move.to);
        }
      }
    }
    setAnimatingMove(anim);
    setBoardIndex(newIndex);
  }

  function stopMatePreview() {
    clearInterval(previewTimerRef.current);
    previewTimerRef.current = null;
    setPreviewStep(-1);
    setPreviewLine(null);
  }

  // Steps the board through a PV's moves one per tick, using the same sliding-piece
  // animation as normal navigation — a hypothetical continuation overlaid on the real
  // board, not the game's actual remaining moves. Shared by the mate panel's own
  // "play it out" button and every per-row "play this forced mate" button in the
  // move list, each supplying whichever line it found the mate in.
  function startPreview(fens, moves) {
    clearInterval(previewTimerRef.current);
    setAnimatingMove(null);
    setPreviewLine({ fens, moves });
    setPreviewStep(0);
    previewTimerRef.current = setInterval(() => {
      setPreviewStep(s => {
        const next = s + 1;
        setAnimatingMove(forwardAnim(moves[next - 1]));
        if (next >= moves.length) {
          clearInterval(previewTimerRef.current);
          previewTimerRef.current = null;
        }
        return next;
      });
    }, 850);
  }

  // Computes this row's mate line on demand from the engine result already cached
  // for it — every mate-flagged row plays or practices its own PV independently.
  function playMateFromRow(row) {
    const res = evalsRef.current[row.idx + 1];
    if (!res || !res.mate) return;
    stopPractice();
    const { fens, moves } = pvToLine(positions[row.idx + 1], res.pv);
    startPreview(fens, moves);
  }

  function stopPractice() {
    setPractice(null);
  }

  // Sets up a solvable puzzle from a mate-flagged row: the board jumps to that
  // position and the practiced (mating) side's moves must be dragged in by hand;
  // the defender's forced replies are played automatically. If the row's mate isn't
  // for the side to move there (evals[].mate is negative — the *opponent* forces
  // mate against whoever's to move), the first PV move is the defender's and gets
  // auto-played immediately so the user's very first turn is always a mating move.
  //
  // `remaining` (not a fixed move list) is the source of truth for progress: every
  // attempted move is re-verified against a fresh engine call rather than compared
  // to the one specific line Stockfish originally happened to record, so any move
  // that objectively keeps the mate on schedule is accepted — not just the exact
  // recorded PV. `nextHintMove` is refreshed from that same engine call each time
  // and exists purely to give the hint system *a* correct answer to point at.
  function practiceMate(row) {
    const res = evalsRef.current[row.idx + 1];
    if (!res || !res.mate) return;
    stopMatePreview();
    const startFen = positions[row.idx + 1];
    const { moves } = pvToLine(startFen, res.pv);
    if (moves.length === 0) return;
    const sideToMoveIsWhite = (row.idx + 1) % 2 === 0;
    const startsWithUser = res.mate > 0; // mate>0 means the side to move here is the one delivering it
    const matingSideIsWhite = startsWithUser ? sideToMoveIsWhite : !sideToMoveIsWhite;

    const chess = new Chess(startFen);
    let idx = 0;
    while (idx < moves.length && !isUsersTurn(idx, startsWithUser)) {
      chess.move(moves[idx].san);
      idx++;
    }
    const mateIn = Math.abs(res.mate);
    setPractice({
      mateIn, matingSideIsWhite,
      chess, fen: chess.fen(), remaining: mateIn, nextHintMove: moves[idx] || null,
      solvedCount: 0, wrongAttempts: 0, hint: null, feedback: null, wrongMove: null, correctMove: null,
      solved: idx >= moves.length, checking: false, animatingMove: null
    });
  }

  // Auto-clears the practice board's sliding animation once its CSS transition
  // has finished — mirrors the top-level animatingMove effect above, kept
  // separate because practice moves (the user's drag + the auto-played reply)
  // are driven independently of normal board navigation.
  useEffect(() => {
    if (!practice || !practice.animatingMove) return;
    const t = setTimeout(() => setPractice(p => (p && p.animatingMove ? { ...p, animatingMove: null } : p)), 220);
    return () => clearTimeout(t);
  }, [practice && practice.animatingMove]);

  // wrongMove marks the attempted (from, to) with a board badge — the text feedback
  // alone was easy to miss since attention is naturally on the board while dragging.
  function registerWrongPracticeAttempt(from, to) {
    setPractice(p => {
      const wrongAttempts = p.wrongAttempts + 1;
      return {
        ...p, wrongAttempts, feedback: 'incorrect', checking: false, wrongMove: { from, to }, correctMove: null,
        hint: wrongAttempts >= 2 && p.nextHintMove ? { from: p.nextHintMove.from } : p.hint
      };
    });
  }

  async function handlePracticeMove(from, to) {
    if (!practice || practice.solved || practice.checking) return;
    const beforeFen = practice.chess.fen();
    const attempt = new Chess(beforeFen);
    const mv = attempt.move({ from, to, promotion: 'q' });
    if (!mv) { registerWrongPracticeAttempt(from, to); return; }

    const remainingAfter = practice.remaining - 1;
    const moveAnim = forwardAnim(mv);
    // Commit the user's move immediately so it visibly slides into place — the
    // drag overlay only shows the piece following the pointer, not landing on its
    // square, so without this the board briefly reverted to the pre-move position
    // and then snapped straight to wherever the (possibly two-move) result ended
    // up once the engine check resolved.
    setPractice(p => ({ ...p, chess: attempt, fen: attempt.fen(), checking: true, wrongMove: null, correctMove: null, animatingMove: moveAnim }));

    // This was meant to be the mating move itself — no position left to hand the
    // engine (a checkmated position has no legal moves for it to search), so verify
    // directly instead.
    if (remainingAfter <= 0) {
      if (attempt.in_checkmate()) {
        setPractice(p => ({
          ...p, remaining: 0, solvedCount: p.solvedCount + 1, wrongAttempts: 0, hint: null,
          wrongMove: null, correctMove: { from, to }, feedback: 'correct', nextHintMove: null, solved: true, checking: false
        }));
      } else {
        setPractice(p => ({ ...p, chess: new Chess(beforeFen), fen: beforeFen, checking: false, animatingMove: null }));
        registerWrongPracticeAttempt(from, to);
      }
      return;
    }

    let res;
    try {
      res = await evaluate(engineRef.current, attempt.fen(), depth);
    } catch {
      setPractice(p => ({ ...p, chess: new Chess(beforeFen), fen: beforeFen, checking: false, animatingMove: null }));
      return;
    }
    // It's the opponent's move now; a move that kept the mate on schedule leaves
    // them forced-lost in exactly the moves remaining (negative = bad for them).
    const stillOnTrack = res.mate != null && res.mate < 0 && Math.abs(res.mate) === remainingAfter;
    if (!stillOnTrack) {
      setPractice(p => ({ ...p, chess: new Chess(beforeFen), fen: beforeFen, checking: false, animatingMove: null }));
      registerWrongPracticeAttempt(from, to);
      return;
    }

    const { moves: continuation } = pvToLine(attempt.fen(), res.pv);
    const replyMove = continuation[0];
    if (!replyMove) {
      setPractice(p => ({
        ...p, remaining: remainingAfter, solvedCount: p.solvedCount + 1, wrongAttempts: 0,
        hint: null, feedback: 'correct', correctMove: { from, to }, checking: false, nextHintMove: null
      }));
      return;
    }
    // A beat after the user's own move lands, slide in the opponent's forced reply
    // rather than applying both moves in one instant jump.
    setTimeout(() => {
      setPractice(p => {
        if (!p || p.fen !== attempt.fen()) return p; // superseded (exited/restarted practice)
        const after = new Chess(attempt.fen());
        after.move(replyMove.san);
        return {
          ...p, chess: after, fen: after.fen(), remaining: remainingAfter,
          solvedCount: p.solvedCount + 1, wrongAttempts: 0, hint: null, wrongMove: null,
          feedback: 'correct', correctMove: { from, to }, nextHintMove: continuation[1] || null,
          checking: false, solved: false, animatingMove: forwardAnim(replyMove)
        };
      });
    }, 260);
  }

  useEffect(() => {
    function onKeyDown(e) {
      if (positions.length === 0) return;
      if (['TEXTAREA', 'INPUT', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goToIndex(boardIndexRef.current - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goToIndex(boardIndexRef.current + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); goToIndex(positions.length - 1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); goToIndex(0); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [positions.length]);

  async function runAnalysis(pgnOverride) {
    stopMatePreview();
    stopPractice();
    revealedSquaresRef.current = new Set();
    stopRef.current = false;
    setBusy(true);
    setRows([]);
    setCounts(null);
    setProgress(0);

    let game;
    try {
      game = parseGame(pgnOverride || pgn);
    } catch (err) {
      setStatus('Error: ' + err.message);
      setBusy(false);
      return;
    }

    const { positions, sanList, moves } = game;
    movesRef.current = moves;
    setPositions(positions);
    boardIndexRef.current = 0;
    setAnimatingMove(null);
    setBoardIndex(0);

    if (!engineRef.current) {
      try {
        setStatus('Fetching engine…');
        engineRef.current = await initEngine();
      } catch (err) {
        setStatus('Engine failed to load (' + err.message + '). Check your network / ad-blocker and try again.');
        setBusy(false);
        return;
      }
    }

    const n = sanList.length;
    const evals = new Array(positions.length);
    evalsRef.current = evals;

    for (let i = 0; i < positions.length; i++) {
      if (stopRef.current) { setStatus('Stopped.'); break; }
      setStatus(`Analyzing position ${i + 1} / ${positions.length}…`);
      setProgress(Math.round((i / positions.length) * 100));
      evals[i] = await evaluate(engineRef.current, positions[i], depth);
      setCurrentEval(whiteEvalOf(evals[i], i % 2 === 0));
    }
    setProgress(100);
    setStatus('Analysis complete.');
    boardIndexRef.current = positions.length - 1;
    setAnimatingMove(null);
    setBoardIndex(positions.length - 1);

    const outRows = [];
    const outCounts = { brilliant: 0, best: 0, good: 0, miss: 0, inaccuracy: 0, mistake: 0, blunder: 0 };

    for (let i = 0; i < n; i++) {
      if (!evals[i] || !evals[i + 1]) break;
      const moverIsWhite = i % 2 === 0;
      const evalBefore = scoreToCp(evals[i]);
      const evalAfterForMover = -scoreToCp(evals[i + 1]);
      const cpLoss = Math.max(0, evalBefore - evalAfterForMover);
      const replyPv = evals[i + 1].pv && evals[i + 1].pv[0];

      // A move ending the game in checkmate leaves no legal moves for the engine to
      // evaluate, so evals[i+1] is just the default {cp:0, mate:null} — not a real
      // read of the position. Left alone, that reads as a catastrophic eval swing
      // (mate score -> 0) and gets misclassified as a blunder or, worse, a "Miss"
      // (the mate score "disappearing" looks exactly like losing a forced mate). The
      // move that actually delivers mate is by definition correct.
      const deliversMate = sanList[i].endsWith('#');
      let cls;
      if (deliversMate) {
        cls = 'best';
      } else {
        const isSac = detectSacrifice({
          positions, i, moverIsWhite, evalBefore, evalAfterForMover, replyPv
        });
        const isMiss = detectMiss({ evalBefore, mateBefore: evals[i].mate, evalAfterForMover, cpLoss });
        cls = classify(cpLoss, isSac, { ply: i, isMiss });
      }
      outCounts[cls]++;

      const row = {
        idx: i,
        moveNo: Math.floor(i / 2) + 1,
        moverIsWhite,
        san: sanList[i],
        cls,
        cpLoss,
        evalBeforeDisplay: fmtEval(evals[i], moverIsWhite),
        evalAfterDisplay: fmtEval(evals[i + 1], !moverIsWhite),
        mateIn: evals[i + 1].mate ? Math.abs(evals[i + 1].mate) : null
      };
      outRows.push(row);
    }

    setRows(outRows);
    setCounts(outCounts);
    setBusy(false);
  }

  async function loadChessComPgn(url) {
    const resp = await fetch('/api/chess-com-game?url=' + encodeURIComponent(url));
    const data = await resp.json();
    if (!resp.ok || !data.pgn) throw new Error(data.error || 'Could not load that game.');
    return data.pgn;
  }

  async function importFromChessCom() {
    if (!chessComUrl.trim()) return;
    setImporting(true);
    setImportError('');
    try {
      const pgnText = await loadChessComPgn(chessComUrl.trim());
      setPgn(pgnText);
      setStatus('Loaded from chess.com. Click "Analyze game" to begin.');
    } catch (err) {
      setImportError(err.message);
    }
    setImporting(false);
  }

  // Reads the clipboard directly, so a chess.com link can go from "just copied
  // on your phone/other tab" to a finished analysis in one click.
  async function pasteAndAnalyzeFromChessCom() {
    setImportError('');
    let text;
    try {
      text = (await navigator.clipboard.readText()).trim();
    } catch {
      setImportError('Could not read the clipboard — your browser may require a permission click, or paste the link into the box manually.');
      return;
    }
    if (!/chess\.com\/(?:[a-z]+\/)*game\/(?:live\/|daily\/)?\d+/i.test(text)) {
      setImportError("That doesn't look like a chess.com game link — copy one and try again.");
      return;
    }
    setChessComUrl(text);
    setImporting(true);
    try {
      const pgnText = await loadChessComPgn(text);
      setPgn(pgnText);
      setImporting(false);
      await runAnalysis(pgnText);
    } catch (err) {
      setImportError(err.message);
      setImporting(false);
    }
  }

  const evalHere = evalsRef.current[boardIndex];
  const bestUci = evalHere && evalHere.pv && evalHere.pv[0];
  const arrow = showArrow && bestUci ? parseUciMove(bestUci) : null;
  const moveHere = boardIndex > 0 ? rows[boardIndex - 1] : null;
  const badgeCls = moveHere && BADGE_CLASSES.includes(moveHere.cls) ? moveHere.cls : null;

  const previewing = previewStep >= 0 && previewLine;
  const displayFen = practice ? practice.fen : previewing ? previewLine.fens[previewStep] : positions[boardIndex];
  const displayLastMove = practice ? undefined : previewing
    ? (previewStep > 0 ? previewLine.moves[previewStep - 1] : undefined)
    : movesRef.current[boardIndex - 1];

  return (
    <div className="wrap">
      <header className="hero">
        <div className="hero-board">
          {Array.from({ length: 16 }).map((_, i) => <div key={i} />)}
        </div>
        <div>
          <h1>f2p chess review</h1>
          <p>Paste a PGN or a chess.com game link. A real chess engine runs in your browser to find every sound sacrifice, the turning point, the mistakes, and any forced mate.</p>
        </div>
      </header>

      <div className="layout">
        <div className="board-column">
          {positions.length > 0 ? (
            <div className="board-panel">
              <div className="board-row">
                <EvalBar cp={currentEval.cp} mate={currentEval.mate} flipped={flipped} />
                <Chessboard
                  fen={displayFen}
                  lastMove={displayLastMove}
                  flipped={flipped}
                  arrow={previewing || practice ? null : arrow}
                  animatingMove={practice ? practice.animatingMove : animatingMove}
                  badgeCls={previewing || practice ? null : badgeCls}
                  revealedSquares={revealedSquaresRef.current}
                  interactive={!!practice && !practice.solved && !practice.checking}
                  onUserMove={handlePracticeMove}
                  legalMovesFrom={practice ? (sq) => practice.chess.moves({ square: sq, verbose: true }).map(m => m.to) : undefined}
                  hintSquare={practice?.hint?.from || null}
                  wrongSquare={practice?.wrongMove?.to || null}
                  correctSquare={practice?.correctMove?.to || null}
                />
              </div>
              <div className="board-nav">
                <button className="small ghost" onClick={() => goToIndex(boardIndex - 1)} disabled={boardIndex === 0}>← Prev</button>
                <span className="mono small">{boardIndex} / {positions.length - 1}</span>
                {evalHere && evalHere.mate ? (
                  <span className="mate-flag" title={`Forced mate in ${Math.abs(evalHere.mate)}`}>#{Math.abs(evalHere.mate)}</span>
                ) : null}
                <button className="small ghost" onClick={() => goToIndex(boardIndex + 1)} disabled={boardIndex === positions.length - 1}>Next →</button>
                <button className={'small' + (showArrow ? '' : ' ghost')} onClick={() => setShowArrow(a => !a)}>
                  {showArrow ? 'Hide best move' : '➜ Show best move'}
                </button>
                <button className="small ghost" onClick={() => setFlipped(f => !f)}>⇅ Flip board</button>
              </div>

              {practice && (
                <div className="practice-panel">
                  <h3>{practice.solved ? '🎉 Solved!' : 'Practice'} — mate in {practice.mateIn} for {practice.matingSideIsWhite ? 'White' : 'Black'}</h3>
                  {!practice.solved && !practice.checking && (
                    <div className="mono" style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                      Drag the winning move onto the board ({practice.matingSideIsWhite ? "White's" : "Black's"} turn) — any move that keeps the mate on schedule counts.
                    </div>
                  )}
                  {practice.checking && <div className="mono" style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Checking…</div>}
                  {practice.feedback === 'incorrect' && !practice.checking && <div className="practice-feedback bad">✗ Not quite — try again.</div>}
                  {practice.feedback === 'correct' && !practice.solved && !practice.checking && <div className="practice-feedback good">✓ Correct!</div>}
                  {practice.hint && !practice.solved && !practice.checking && (
                    <div className="practice-feedback hint">Hint: move the piece on {practice.hint.from}.</div>
                  )}
                  <div className="row">
                    <button className="small ghost" onClick={stopPractice}>✕ Exit practice</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="board-empty">
              <div className="board-empty-icon">
                {Array.from({ length: 16 }).map((_, i) => <div key={i} />)}
              </div>
              <p>Paste a PGN in the panel and click Analyze to bring up the board.</p>
            </div>
          )}

          {previewing && (
            <div className="mate-panel">
              <div className="row" style={{ marginTop: 0 }}>
                <button className="small ghost" onClick={stopMatePreview}>■ Stop preview</button>
                <span className="mono small" style={{ color: 'var(--ink-soft)' }}>
                  {previewStep} / {previewLine.moves.length}
                </span>
              </div>
              <div className="note">Previewing the engine's mating line, not necessarily the moves actually played from here.</div>
            </div>
          )}
        </div>

        <div className="side-panel">
          <div className="panel">
            <h2>Game</h2>
            <div className="row chess-com-import">
              <input
                type="text"
                className="mono"
                placeholder="Paste a chess.com game link…"
                value={chessComUrl}
                onChange={e => setChessComUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') importFromChessCom(); }}
              />
              <button className="small ghost" onClick={importFromChessCom} disabled={importing || !chessComUrl.trim()}>
                {importing ? 'Loading…' : 'Load'}
              </button>
              <button className="small" onClick={pasteAndAnalyzeFromChessCom} disabled={importing || busy}>
                📋 Paste &amp; analyze
              </button>
            </div>
            {importError && <div className="status mono" style={{ color: 'var(--blunder)' }}>{importError}</div>}
            <textarea value={pgn} onChange={e => setPgn(e.target.value)} />
            <div className="row">
              <label className="small">Depth
                <select value={depth} onChange={e => setDepth(parseInt(e.target.value, 10))}>
                  <option value={10}>10 (fast)</option>
                  <option value={12}>12 (balanced)</option>
                  <option value={15}>15 (slower, stronger)</option>
                </select>
              </label>
            </div>
            <div className="row">
              <button onClick={() => runAnalysis()} disabled={busy}>Analyze game</button>
              <button className="ghost" onClick={() => { stopRef.current = true; }} disabled={!busy}>Stop</button>
            </div>
            <div className="status mono">{status}</div>
            <div className="progress-track"><div className="progress-fill" style={{ width: progress + '%' }} /></div>
          </div>

          {rows.length > 0 && (
            <div className="review-panel">
              <div className="review-header">
                <h2>Analysis</h2>
                <span className="review-engine mono">Stockfish 11 · depth {depth}</span>
              </div>
              <div className="movelist" ref={movelistRef}>
                {movePairs(rows).map(p => (
                  <div className="move-pair" key={p.moveNo}>
                    <div className="move-num mono">{p.moveNo}</div>
                    <MoveCell row={p.white} active={boardIndex === (p.white?.idx ?? -2) + 1} onSelect={goToIndex} onPlayMate={playMateFromRow} onPracticeMate={practiceMate} busyWithMate={!!previewing || !!practice} />
                    <MoveCell row={p.black} active={boardIndex === (p.black?.idx ?? -2) + 1} onSelect={goToIndex} onPlayMate={playMateFromRow} onPracticeMate={practiceMate} busyWithMate={!!previewing || !!practice} />
                  </div>
                ))}
              </div>
              {counts && (
                <div className="review-summary">
                  {['brilliant', 'best', 'good', 'miss', 'inaccuracy', 'mistake', 'blunder']
                    .filter(k => counts[k] > 0)
                    .map(k => (
                      <span className="review-chip" key={k}>
                        <span className={'chip-dot dot-' + k} />{counts[k]} {TAG_LABEL[k]}
                      </span>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
