// Lichess-style logistic curve: saturates smoothly instead of clipping hard at the edges.
function cpToWhitePercent(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.004 * cp)) - 1);
}

// whiteEval: { cp, mate } already in White's perspective (see analysis.js#whiteEvalOf).
// flipped: when true, the side at the bottom of the board (Black) is also at the bottom of the bar.
export default function EvalBar({ cp, mate, flipped }) {
  const isMate = mate !== null && mate !== undefined;
  const whitePercent = isMate ? (mate > 0 ? 100 : 0) : cpToWhitePercent(cp);
  const label = isMate ? '#' + mate : (cp >= 0 ? '+' : '') + (cp / 100).toFixed(1);
  const whiteFill = <div className="eval-bar-white" style={{ height: whitePercent + '%' }} />;
  const blackFill = <div className="eval-bar-black" style={{ height: (100 - whitePercent) + '%' }} />;

  return (
    <div className="eval-bar">
      {flipped ? <>{whiteFill}{blackFill}</> : <>{blackFill}{whiteFill}</>}
      <div className="eval-bar-label mono">{label}</div>
    </div>
  );
}
