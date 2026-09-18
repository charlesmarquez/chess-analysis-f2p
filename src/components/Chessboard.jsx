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

// fen: full FEN string. lastMove: chess.js verbose move object ({ from, to }) or undefined.
// flipped: true shows Black's perspective (Black at the bottom).
// arrow: { from, to } squares to draw a translucent suggestion arrow between, or null/undefined.
export default function Chessboard({ fen, lastMove, flipped = false, arrow }) {
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

  const rankOrder = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const fileOrder = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  return (
    <div className="chessboard">
      {rankOrder.map((rIdx, displayR) => (
        <div className="board-rank" key={rIdx}>
          {fileOrder.map((fIdx, displayF) => {
            const piece = ranks[rIdx][fIdx];
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
                {piece && <img className="piece" src={`/pieces/${PIECE_FILE[piece]}.svg`} alt={PIECE_FILE[piece]} draggable={false} />}
              </div>
            );
          })}
        </div>
      ))}
      {arrow && <BestMoveArrow from={arrow.from} to={arrow.to} flipped={flipped} />}
    </div>
  );
}

function BestMoveArrow({ from, to, flipped }) {
  const a = squareToXY(from, flipped);
  const b = squareToXY(to, flipped);
  return (
    <svg className="board-arrows" viewBox="0 0 8 8">
      <defs>
        <marker id="best-move-arrowhead" markerWidth="3" markerHeight="3" refX="2.2" refY="1.5" orient="auto">
          <polygon points="0 0, 3 1.5, 0 3" fill="rgba(60, 130, 246, 0.65)" />
        </marker>
      </defs>
      <line
        x1={a.x + 0.5} y1={a.y + 0.5} x2={b.x + 0.5} y2={b.y + 0.5}
        stroke="rgba(60, 130, 246, 0.55)" strokeWidth="0.6" strokeLinecap="round"
        markerEnd="url(#best-move-arrowhead)"
      />
    </svg>
  );
}
