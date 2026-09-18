import { useMemo } from 'react';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const PIECE_FILE = {
  K: 'wK', Q: 'wQ', R: 'wR', B: 'wB', N: 'wN', P: 'wP',
  k: 'bK', q: 'bQ', r: 'bR', b: 'bB', n: 'bN', p: 'bP'
};

// fen: full FEN string. lastMove: chess.js verbose move object ({ from, to }) or undefined.
// selected: currently selected square (or null). legalTargets: array of destination squares to hint.
// onSquareClick(square): if provided, the board becomes clickable.
export default function Chessboard({ fen, lastMove, selected, legalTargets = [], onSquareClick }) {
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

  return (
    <div className={'chessboard' + (onSquareClick ? ' interactive' : '')}>
      {ranks.map((rank, rIdx) => (
        <div className="board-rank" key={rIdx}>
          {rank.map((piece, fIdx) => {
            const square = FILES[fIdx] + (8 - rIdx);
            const isLight = (rIdx + fIdx) % 2 === 0;
            const isHighlighted = lastMove && (square === lastMove.from || square === lastMove.to);
            const isSelected = selected === square;
            const isLegalTarget = legalTargets.includes(square);
            return (
              <div
                key={square}
                data-square={square}
                className={'board-square' + (isLight ? ' light' : ' dark') + (isHighlighted ? ' highlight' : '') + (isSelected ? ' selected' : '')}
                onClick={onSquareClick ? () => onSquareClick(square) : undefined}
              >
                {fIdx === 0 && <span className="coord rank-coord">{8 - rIdx}</span>}
                {rIdx === 7 && <span className="coord file-coord">{FILES[fIdx]}</span>}
                {piece && <img className="piece" src={`/pieces/${PIECE_FILE[piece]}.svg`} alt={PIECE_FILE[piece]} draggable={false} />}
                {isLegalTarget && <span className="legal-dot" />}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
