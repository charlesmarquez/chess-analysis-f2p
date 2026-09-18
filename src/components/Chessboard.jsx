import { useMemo } from 'react';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const PIECE_FILE = {
  K: 'wK', Q: 'wQ', R: 'wR', B: 'wB', N: 'wN', P: 'wP',
  k: 'bK', q: 'bQ', r: 'bR', b: 'bB', n: 'bN', p: 'bP'
};

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

// fen: full FEN string. lastMove: chess.js verbose move object ({ from, to }) or undefined.
// flipped: true shows Black's perspective (Black at the bottom).
// arrow: { from, to } squares to draw a translucent suggestion arrow between, or null/undefined.
// animatingMove: { pieceFrom, pieceTo, rookFrom?, rookTo? } — squares (in "current fen" terms)
// whose occupant should slide in from its previous square instead of popping in place.
export default function Chessboard({ fen, lastMove, flipped = false, arrow, animatingMove }) {
  const ranks = useMemo(() => {
    const boardPart = fen.split(' ')[0];
    return boardPart.split('/').map(rank => {
      const squares = [];
      for (const ch of rank) {
        if (/\d/.test(ch)) {
          for (let i = 0; i < Number(ch); i++) squares.push(null);
        } else {
          squares.push(ch);
        }
      }
      return squares;
    });
  }, [fen]);

  const pieces = useMemo(() => occupiedSquares(fen), [fen]);

  const rankOrder = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const fileOrder = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  return (
    <div className="chessboard">
      {rankOrder.map((rIdx, displayR) => (
        <div className="board-rank" key={rIdx}>
          {fileOrder.map((fIdx, displayF) => {
            const square = FILES[fIdx] + (8 - rIdx);
            const isLight = (rIdx + fIdx) % 2 === 0;
            const isHighlighted = lastMove && (square === lastMove.from || square === lastMove.to);
            return (
              <div
                key={square}
                data-square={square}
                className={'board-square' + (isLight ? ' light' : ' dark') + (isHighlighted ? ' highlight' : '')}
              >
                {displayF === 0 && <span className="coord rank-coord">{8 - rIdx}</span>}
                {displayR === 7 && <span className="coord file-coord">{FILES[fIdx]}</span>}
              </div>
            );
          })}
        </div>
      ))}
      <div className="piece-layer">
        {pieces
          .map(({ square, piece }) => {
            // Key the animated piece by the square it occupied *before* this transition
            // (matching the key its DOM node had on the previous render) so React reuses
            // the same element and its transform change animates instead of popping.
            let key = 'sq:' + square;
            if (animatingMove) {
              if (square === animatingMove.pieceTo) key = 'sq:' + animatingMove.pieceFrom;
              else if (square === animatingMove.rookTo) key = 'sq:' + animatingMove.rookFrom;
              // Undoing a capture: the reappearing piece sits on the same square the
              // retreating piece is keyed by above (its own pre-undo square) — namespace
              // it separately so the two don't collide on one key.
              else if (square === animatingMove.revealedSquare) key = 'revealed:' + square;
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
                <img className="piece" src={`/pieces/${PIECE_FILE[piece]}.svg`} alt={PIECE_FILE[piece]} draggable={false} />
              </div>
            );
          })}
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
