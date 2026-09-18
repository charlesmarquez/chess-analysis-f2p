import { useMemo } from 'react';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const PIECE_GLYPH = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟'
};

// fen: full FEN string. lastMove: chess.js verbose move object ({ from, to }) or undefined.
export default function Chessboard({ fen, lastMove }) {
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
    <div className="chessboard">
      {ranks.map((rank, rIdx) => (
        <div className="board-rank" key={rIdx}>
          {rank.map((piece, fIdx) => {
            const square = FILES[fIdx] + (8 - rIdx);
            const isLight = (rIdx + fIdx) % 2 === 0;
            const isHighlighted = lastMove && (square === lastMove.from || square === lastMove.to);
            return (
              <div
                key={square}
                className={'board-square' + (isLight ? ' light' : ' dark') + (isHighlighted ? ' highlight' : '')}
              >
                {fIdx === 0 && <span className="coord rank-coord">{8 - rIdx}</span>}
                {rIdx === 7 && <span className="coord file-coord">{FILES[fIdx]}</span>}
                {piece && <span className="piece">{PIECE_GLYPH[piece]}</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
