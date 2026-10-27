import { useLayoutEffect, useRef, useState } from "react";
import type { AttackView } from "../../server/src/test/protocol";

export default function TestAttackArrow({ attack, revision }: { attack: AttackView | null; revision: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [line, setLine] = useState<number[] | null>(null);
  useLayoutEffect(() => {
    const root = ref.current?.parentElement;
    if (!root || !attack) { setLine(null); return; }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const cards = Array.from(root.querySelectorAll<HTMLElement>(".test-playmat [data-card-id]"));
        const source = cards.find((card) => card.dataset.cardId === attack.sourceId);
        const target = cards.find((card) => card.dataset.cardId === attack.targetId);
        if (!source || !target) { setLine(null); return; }
        const a = source.getBoundingClientRect(), b = target.getBoundingClientRect(), r = root.getBoundingClientRect();
        setLine([a.x + a.width / 2 - r.x, a.y + a.height / 2 - r.y, b.x + b.width / 2 - r.x, b.y + b.height / 2 - r.y]);
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    root.querySelectorAll(".test-standard-player").forEach((element) => observer.observe(element));
    window.addEventListener("resize", measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); cancelAnimationFrame(frame); };
  }, [attack, revision]);
  return <svg ref={ref} className="test-attack-arrow" aria-hidden="true">
    <defs><marker id="test-attack-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#facc15" /></marker></defs>
    {line && <><line x1={line[0]} y1={line[1]} x2={line[2]} y2={line[3]} stroke="#422006" strokeWidth="7" /><line x1={line[0]} y1={line[1]} x2={line[2]} y2={line[3]} stroke="#facc15" strokeWidth="4" markerEnd="url(#test-attack-head)" /></>}
  </svg>;
}
