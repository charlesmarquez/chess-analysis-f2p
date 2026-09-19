import { useMemo, useRef, useState, useEffect } from 'react';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const PIECE_FILE = {
  K: 'wK', Q: 'wQ', R: 'wR', B: 'wB', N: 'wN', P: 'wP',
  k: 'bK', q: 'bQ', r: 'bR', b: 'bB', n: 'bN', p: 'bP'
};
const BADGE_SYMBOL = { brilliant: '!!', best: '✓', mistake: '?', blunder: '??', miss: '?!' };

// Visual (column, row) of a square, 0-7 left-to-right / top-to-bottom, honoring board orientation.
function squareToXY(square, flipped) {
  const f = FILES.indexOf(square[0]);
  const r = 8 - parseInt(square[1], 10);
  return { x: flipped ? 7 - f : f, y: flipped ? 7 - r : r };
}

// Squares (in board order) occupied on the current FEN, e.g. [{ square: 'e4', piece: 'P' }, ...].
function occupiedSquares(fen) {
  const out = [];
  fen.split(' ')[0].split('/').forEach((rank, rIdx) => {
    let fIdx = 0;
    for (const ch of rank) {
      if (/\d/.test(ch)) { fIdx += Number(ch); continue; }
      out.push({ square: FILES[fIdx] + (8 - rIdx), piece: ch });
      fIdx++;
    }
  });
  return out;
}

// Inverse of squareToXY: given a point as a 0-1 fraction of the board's own
// width/height, returns the square under it (or null outside the board).
function pointToSquare(fracX, fracY, flipped) {
  if (fracX < 0 || fracX >= 1 || fracY < 0 || fracY >= 1) return null;
  const col = Math.floor(fracX * 8);
  const row = Math.floor(fracY * 8);
  const f = flipped ? 7 - col : col;
  const r = flipped ? 7 - row : row;
  return FILES[f] + (8 - r);
}

// fen: full FEN string. lastMove: chess.js verbose move object ({ from, to }) or undefined.
// flipped: true shows Black's perspective (Black at the bottom).
// arrow: { from, to } squares to draw a translucent suggestion arrow between, or null/undefined.
// animatingMove: { pieceFrom, pieceTo, rookFrom?, rookTo? } — squares (in "current fen" terms)
// whose occupant should slide in from its previous square instead of popping in place.
// badgeCls: one of 'brilliant'/'best'/'mistake'/'blunder' — draws a chess.com-style
// annotation icon on lastMove.to, or omit/null for no badge.
// revealedSquares: a Set of squares ever restored by an undone capture (see App.jsx).
// Kept namespaced under 'revealed:' permanently rather than just during that one
// animation: once the animation's 220ms auto-clear reverts animatingMove to null, every
// square falls back to the plain 'sq:'+square key — including the revealed square,
// which is exactly the string the *departing* piece was using as ITS key a moment
// earlier (a capture-undo's pieceFrom and revealedSquare are always the same square).
// React would then treat the revealed piece as a continuation of the departing piece's
// element and animate it sliding away from wherever that piece ended up.
// interactive + onUserMove(from, to): when set, pieces can be picked up (mouse or
// touch) and dropping one on a square calls onUserMove — used by mate-practice mode.
// This is a custom pointer-driven drag rather than native HTML5 DnD: it sidesteps a
// real class of native-DnD bugs (an occupied target square's own piece needs
// pointer-events to be draggable itself, which then silently swallows the drop meant
// for the square beneath it on captures) and gives full control over the drag visual
// (piece follows the pointer centered exactly, not the browser's default ghost image).
// legalMovesFrom(square): returns the array of legal destination squares for the piece
// being picked up, to render as chess.com-style move dots while dragging.
// hintSquare: a square to highlight as "move this piece" (practice mode, after
// repeated wrong attempts). wrongSquare: the destination of the most recent wrong
// practice attempt, marked with a red X badge (cleared on the next attempt).
// correctSquare: the destination of the most recent correct practice attempt,
// marked with a green check badge (cleared on the next attempt).
export default function Chessboard({ fen, lastMove, flipped = false, arrow, animatingMove, badgeCls, revealedSquares, interactive, onUserMove, legalMovesFrom, hintSquare, wrongSquare, correctSquare }) {
  const boardRef = useRef(null);
  const [drag, setDrag] = useState(null); // { square, x, y, hoverSquare } in board-local px, or null

  const pieces = useMemo(() => occupiedSquares(fen), [fen]);
  const pieceAt = useMemo(() => Object.fromEntries(pieces.map(p => [p.square, p.piece])), [pieces]);
  const legalTargets = useMemo(
    () => (drag && legalMovesFrom ? legalMovesFrom(drag.square) : []),
    [drag && drag.square, legalMovesFrom]
  );

  function pointFromEvent(e) {
    const rect = boardRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, h: rect.height };
  }

  function startDrag(e, square) {
    if (!interactive) return;
    e.preventDefault();
    const p = pointFromEvent(e);
    setDrag({ square, x: p.x, y: p.y, hoverSquare: square });
  }

  useEffect(() => {
    if (!drag) return;
    document.body.style.cursor = 'grabbing';
    function onMove(e) {
      const p = pointFromEvent(e);
      setDrag(d => d && { ...d, x: p.x, y: p.y, hoverSquare: pointToSquare(p.x / p.w, p.y / p.h, flipped) });
    }
    function onUp(e) {
      const p = pointFromEvent(e);
      const target = pointToSquare(p.x / p.w, p.y / p.h, flipped);
      const fromSquare = drag.square;
      setDrag(null);
      // Called after setDrag, not from within its updater — calling another
      // component's setState (App's, via onUserMove) inside a setState updater
      // function triggers React's "Cannot update a component while rendering a
      // different component" warning.
      if (target && target !== fromSquare) onUserMove(fromSquare, target);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!drag]);

  const rankOrder = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const fileOrder = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  return (
    <div className={'chessboard' + (drag ? ' dragging' : '')} ref={boardRef}>
      {rankOrder.map((rIdx, displayR) => (
        <div className="board-rank" key={rIdx}>
          {fileOrder.map((fIdx, displayF) => {
            const square = FILES[fIdx] + (8 - rIdx);
            const isLight = (rIdx + fIdx) % 2 === 0;
            const isHighlighted = lastMove && (square === lastMove.from || square === lastMove.to);
            const isHint = hintSquare === square;
            const isLegalTarget = !!drag && legalTargets.includes(square);
            const isDragHover = !!drag && drag.hoverSquare === square && square !== drag.square;
            return (
              <div
                key={square}
                data-square={square}
                className={
                  'board-square' + (isLight ? ' light' : ' dark') + (isHighlighted ? ' highlight' : '')
                  + (isHint ? ' hint' : '') + (isDragHover ? ' drag-hover' : '')
                }
              >
                {displayF === 0 && <span className="coord rank-coord">{8 - rIdx}</span>}
                {displayR === 7 && <span className="coord file-coord">{FILES[fIdx]}</span>}
                {badgeCls && lastMove && square === lastMove.to && (
                  <span className={'move-badge badge-' + badgeCls}>{BADGE_SYMBOL[badgeCls]}</span>
                )}
                {wrongSquare === square && (
                  <span className="move-badge badge-wrong-attempt">✗</span>
                )}
                {correctSquare === square && (
                  <span className="move-badge badge-correct-attempt">✓</span>
                )}
                {isLegalTarget && (
                  <span className={'legal-dot' + (pieceAt[square] ? ' capture' : '')} />
                )}
              </div>
            );
          })}
        </div>
      ))}
      <div className="piece-layer">
        {pieces
          .filter(({ square }) => !drag || square !== drag.square)
          .map(({ square, piece }) => {
            // Key the animated piece by the square it occupied *before* this transition
            // (matching the key its DOM node had on the previous render) so React reuses
            // the same element and its transform change animates instead of popping.
            let key = 'sq:' + square;
            if (animatingMove && square === animatingMove.pieceTo) key = 'sq:' + animatingMove.pieceFrom;
            else if (animatingMove && square === animatingMove.rookTo) key = 'sq:' + animatingMove.rookFrom;
            else if ((animatingMove && square === animatingMove.revealedSquare) || (revealedSquares && revealedSquares.has(square))) {
              key = 'revealed:' + square;
            }
            return { key, square, piece };
          })
          // Render order follows the (frozen, pre-move) key rather than the current square,
          // so a moving piece's array position doesn't shift relative to its siblings. React
          // otherwise has to insertBefore it into its new slot, and repositioning + restyling
          // an element in the same commit makes browsers skip the CSS transition entirely.
          .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
          .map(({ key, square, piece }) => {
            const { x, y } = squareToXY(square, flipped);
            return (
              <div className="piece-cell" key={key} style={{ transform: `translate(${x * 100}%, ${y * 100}%)` }}>
                <img
                  className={'piece' + (interactive ? ' draggable' : '')}
                  src={`/pieces/${PIECE_FILE[piece]}.svg`}
                  alt={PIECE_FILE[piece]}
                  data-square={square}
                  draggable={false}
                  onPointerDown={interactive ? e => startDrag(e, square) : undefined}
                />
              </div>
            );
          })}
        {drag && (
          <div
            className="piece-cell dragging-piece"
            style={{ transform: `translate(${drag.x}px, ${drag.y}px) translate(-50%, -50%)` }}
          >
            <img className="piece" src={`/pieces/${PIECE_FILE[pieceAt[drag.square]]}.svg`} alt="" draggable={false} />
          </div>
        )}
      </div>
      {arrow && <BestMoveArrow from={arrow.from} to={arrow.to} flipped={flipped} />}
    </div>
  );
}

// Single filled polygon (shaft + head as one shape) so a translucent fill never
// double-blends where a separate stroke and marker would otherwise overlap.
function arrowPolygonPoints(start, end, { shaftW, headW, headLen }) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const shaftEnd = { x: end.x - ux * headLen, y: end.y - uy * headLen };
  const offset = (p, o) => `${p.x + px * o},${p.y + py * o}`;
  return [
    offset(start, shaftW / 2),
    offset(shaftEnd, shaftW / 2),
    offset(shaftEnd, headW / 2),
    `${end.x},${end.y}`,
    offset(shaftEnd, -headW / 2),
    offset(shaftEnd, -shaftW / 2),
    offset(start, -shaftW / 2)
  ].join(' ');
}

function BestMoveArrow({ from, to, flipped }) {
  const a = squareToXY(from, flipped);
  const b = squareToXY(to, flipped);
  const start = { x: a.x + 0.5, y: a.y + 0.5 };
  const endRaw = { x: b.x + 0.5, y: b.y + 0.5 };
  const dx = endRaw.x - start.x, dy = endRaw.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const end = { x: endRaw.x - (dx / len) * 0.12, y: endRaw.y - (dy / len) * 0.12 };
  const points = arrowPolygonPoints(start, end, { shaftW: 0.09, headW: 0.24, headLen: 0.26 });

  return (
    <svg className="board-arrows" viewBox="0 0 8 8">
      <polygon points={points} fill="rgba(50, 120, 230, 0.5)" />
    </svg>
  );
}
