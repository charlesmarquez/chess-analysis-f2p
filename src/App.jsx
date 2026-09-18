import { useEffect, useRef, useState } from 'react';
import { initEngine, evaluate } from './lib/engine.js';
import { parseGame, scoreToCp, fmtEval, classify, detectSacrifice, TAG_LABEL } from './lib/analysis.js';
import Chessboard from './components/Chessboard.jsx';

const ROW_CLASS = {
  brilliant: 'flagged', best: '', good: '', inaccuracy: 'bad', mistake: 'bad', blunder: 'worse'
};

function movePairs(rows) {
  const pairs = [];
  for (const r of rows) {
    const i = r.moveNo - 1;
    if (!pairs[i]) pairs[i] = { moveNo: r.moveNo };
    pairs[i][r.moverIsWhite ? 'white' : 'black'] = r;
  }
  return pairs;
}

function MoveCell({ row, active, onSelect }) {
  if (!row) return <div className="move-cell empty" />;
  return (
    <div
      className={'move-cell ' + ROW_CLASS[row.cls] + (active ? ' active' : '')}
      title={`${row.evalBeforeDisplay} → ${row.evalAfterDisplay}`}
      onClick={() => onSelect(row.idx + 1)}
    >
      {row.san}<span className={'move-tag tag-' + row.cls}>{TAG_LABEL[row.cls]}</span>
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
  const [depth, setDepth] = useState(12);
  const [status, setStatus] = useState('Ready. Click "Analyze game" to load the engine and begin.');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState(null);
  const [turningPoint, setTurningPoint] = useState(null);
  const [askText, setAskText] = useState('');
  const [askAnswer, setAskAnswer] = useState('');
  const [asking, setAsking] = useState(false);
  const [positions, setPositions] = useState([]);
  const [boardIndex, setBoardIndex] = useState(0);

  const engineRef = useRef(null);
  const stopRef = useRef(false);
  const analysisRef = useRef(null);
  const movesRef = useRef([]);

  useEffect(() => {
    function onKeyDown(e) {
      if (positions.length === 0) return;
      if (['TEXTAREA', 'INPUT', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); setBoardIndex(i => Math.max(0, i - 1)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setBoardIndex(i => Math.min(positions.length - 1, i + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setBoardIndex(0); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setBoardIndex(positions.length - 1); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [positions.length]);

  async function runAnalysis() {
    stopRef.current = false;
    setBusy(true);
    setRows([]);
    setCounts(null);
    setTurningPoint(null);
    setAskAnswer('');
    setProgress(0);

    let game;
    try {
      game = parseGame(pgn);
    } catch (err) {
      setStatus('Error: ' + err.message);
      setBusy(false);
      return;
    }

    const { positions, sanList, moves } = game;
    movesRef.current = moves;
    setPositions(positions);
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

    for (let i = 0; i < positions.length; i++) {
      if (stopRef.current) { setStatus('Stopped.'); break; }
      setStatus(`Analyzing position ${i + 1} / ${positions.length}…`);
      setProgress(Math.round((i / positions.length) * 100));
      evals[i] = await evaluate(engineRef.current, positions[i], depth);
    }
    setProgress(100);
    setStatus('Analysis complete.');
    setBoardIndex(positions.length - 1);

    const outRows = [];
    const outCounts = { brilliant: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    let biggestSwing = null;

    for (let i = 0; i < n; i++) {
      if (!evals[i] || !evals[i + 1]) break;
      const moverIsWhite = i % 2 === 0;
      const evalBefore = scoreToCp(evals[i]);
      const evalAfterForMover = -scoreToCp(evals[i + 1]);
      const cpLoss = Math.max(0, evalBefore - evalAfterForMover);
      const replyPv = evals[i + 1].pv && evals[i + 1].pv[0];

      const isSac = detectSacrifice({
        positions, i, moverIsWhite, evalBefore, evalAfterForMover, replyPv
      });

      const cls = classify(cpLoss, isSac);
      outCounts[cls]++;

      const row = {
        idx: i,
        moveNo: Math.floor(i / 2) + 1,
        moverIsWhite,
        san: sanList[i],
        cls,
        cpLoss,
        evalBeforeDisplay: fmtEval(evals[i], moverIsWhite),
        evalAfterDisplay: fmtEval(evals[i + 1], !moverIsWhite)
      };
      outRows.push(row);

      const swingMag = Math.abs(cpLoss) + (cls === 'brilliant' ? 250 : 0);
      if (!biggestSwing || swingMag > biggestSwing.mag) biggestSwing = { mag: swingMag, row };
    }

    analysisRef.current = { rows: outRows, counts: outCounts, biggestSwing };
    setRows(outRows);
    setCounts(outCounts);
    setTurningPoint(biggestSwing ? biggestSwing.row : null);
    setBusy(false);
  }

  async function askClaude() {
    if (!analysisRef.current) return;
    setAsking(true);
    setAskAnswer('Thinking…');
    const { rows: r, biggestSwing } = analysisRef.current;
    const flagged = r.filter(x => x.cls === 'brilliant' || x.cls === 'blunder' || x.cls === 'mistake');
    const compact = flagged.map(x =>
      `${x.moveNo}${x.moverIsWhite ? '.' : '...'}${x.san} [${TAG_LABEL[x.cls]}, eval ${x.evalBeforeDisplay}->${x.evalAfterDisplay}]`
    ).join('\n');
    const tp = biggestSwing ? biggestSwing.row : null;
    const tpLine = tp ? `${tp.moveNo}${tp.moverIsWhite ? '.' : '...'}${tp.san}` : 'n/a';

    const prompt = `You are a chess coach. Here is engine-verified move classification data from a game (SAN moves with tags and centipawn-ish evals, White's perspective):\n\n${compact}\n\nTurning point move: ${tpLine}\n\n` +
      (askText.trim()
        ? `The user asks: ${askText.trim()}`
        : 'Give a short (4-6 sentence) narrative explaining the Brilliant move(s) and the turning point, in a clear coaching tone.') +
      '\n\nBe concrete and specific to these moves; do not invent moves not listed.';

    try {
      const resp = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const data = await resp.json();
      setAskAnswer(data.text || data.error || 'No response.');
    } catch (err) {
      setAskAnswer('Could not reach the explanation service: ' + err.message);
    }
    setAsking(false);
  }

  function downloadReport() {
    if (!analysisRef.current) return;
    let md = '# Brilliancy Desk report\n\n| Move | Classification | Eval before | Eval after |\n|---|---|---|---|\n';
    analysisRef.current.rows.forEach(r => {
      md += `| ${r.moveNo}${r.moverIsWhite ? '.' : '...'}${r.san} | ${TAG_LABEL[r.cls]} | ${r.evalBeforeDisplay} | ${r.evalAfterDisplay} |\n`;
    });
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'brilliancy-report.md';
    a.click();
  }

  return (
    <div className="wrap">
      <header className="hero">
        <div className="hero-board">
          {Array.from({ length: 16 }).map((_, i) => <div key={i} />)}
        </div>
        <div>
          <h1>Brilliancy Desk</h1>
          <p>Paste a PGN. A real chess engine runs in your browser to find every sound sacrifice, the turning point, and the mistakes — then Claude explains what it found.</p>
        </div>
      </header>

      <div className="layout">
        <div className="sidebar">
          <div className="panel">
            <h2>Game</h2>
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
              <button onClick={runAnalysis} disabled={busy}>Analyze game</button>
              <button className="ghost" onClick={() => { stopRef.current = true; }} disabled={!busy}>Stop</button>
            </div>
            <div className="status mono">{status}</div>
            <div className="progress-track"><div className="progress-fill" style={{ width: progress + '%' }} /></div>
          </div>

          {counts && (
            <div className="panel">
              <h2>Summary</h2>
              <div className="stat-grid">
                {['brilliant', 'blunder', 'mistake', 'inaccuracy', 'good', 'best'].map(k => (
                  <div className="stat" key={k}>
                    <span className="n mono">{counts[k]}</span>
                    <span className="l">{TAG_LABEL[k]}</span>
                  </div>
                ))}
              </div>
              <div className="note">
                A move is flagged <strong>Brilliant</strong> when it's the engine's best (or near-best) choice, it hands over material the engine's own main line lets the opponent take, the position wasn't already decisively winning beforehand, and the sacrifice doesn't leave the mover worse off — an approximation of chess.com's stated criteria, computed from a real (if modest-strength) engine.
              </div>
            </div>
          )}
        </div>

        <div className="main">
          {positions.length > 0 && (
            <div className="board-panel">
              <Chessboard fen={positions[boardIndex]} lastMove={movesRef.current[boardIndex - 1]} />
              <div className="board-nav">
                <button className="small ghost" onClick={() => setBoardIndex(i => Math.max(0, i - 1))} disabled={boardIndex === 0}>← Prev</button>
                <span className="mono small">{boardIndex} / {positions.length - 1}</span>
                <button className="small ghost" onClick={() => setBoardIndex(i => Math.min(positions.length - 1, i + 1))} disabled={boardIndex === positions.length - 1}>Next →</button>
              </div>
            </div>
          )}

          {turningPoint && (
            <div className="turning-point">
              <h3>Turning point — {turningPoint.moveNo}{turningPoint.moverIsWhite ? '.' : '...'}{turningPoint.san}</h3>
              <div className="mono" style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                {turningPoint.moverIsWhite ? 'White' : 'Black'} · eval swung from {turningPoint.evalBeforeDisplay} to {turningPoint.evalAfterDisplay} · classified as {TAG_LABEL[turningPoint.cls]}
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="panel">
              <h2>Move by move</h2>
              <div className="movelist">
                {movePairs(rows).map(p => (
                  <div className="move-pair" key={p.moveNo}>
                    <div className="move-num mono">{p.moveNo}</div>
                    <MoveCell row={p.white} active={boardIndex === (p.white?.idx ?? -2) + 1} onSelect={setBoardIndex} />
                    <MoveCell row={p.black} active={boardIndex === (p.black?.idx ?? -2) + 1} onSelect={setBoardIndex} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="panel ask-box" style={{ marginTop: 18 }}>
              <h2>Ask about this game</h2>
              <textarea
                placeholder="e.g. Why does this move actually work? What should have been played instead?"
                value={askText}
                onChange={e => setAskText(e.target.value)}
                style={{ minHeight: 60 }}
              />
              <div className="row">
                <button className="small" onClick={askClaude} disabled={asking}>Ask Claude</button>
                <button className="small ghost" onClick={downloadReport}>Download report (.md)</button>
              </div>
              {askAnswer && <div className="answer">{askAnswer}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
