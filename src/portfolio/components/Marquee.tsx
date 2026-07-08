// Oversized outline-text marquee strip — pure CSS animation, static under reduced motion.
export function Marquee({ text }: { text: string }) {
  // NBSP terminator: a plain trailing space collapses at the flex-item boundary,
  // making the loop seam visibly wider than the internal separators.
  const chunk = `${text} — `;
  const line = chunk.repeat(4);
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">
        <span>{line}</span>
        <span>{line}</span>
      </div>
    </div>
  );
}
