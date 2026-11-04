import { useEffect, useRef, useState, type CSSProperties } from "react";

export function ConnectionAddress({ address, focusable = true }: { address: string; focusable?: boolean }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;
    const measure = () => {
      setOverflow(Math.max(0, Math.ceil(text.getBoundingClientRect().width - container.clientWidth)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [address]);

  return <span ref={containerRef} className="conn-card__host" title={address}
    data-overflow={overflow > 0} tabIndex={focusable && overflow > 0 ? 0 : undefined}
    style={{ "--address-scroll-offset": `${-overflow}px`, "--address-scroll-duration": `${Math.max(3, overflow / 32 + 1)}s` } as CSSProperties}>
    <span ref={textRef} className="conn-card__host-text">{address}</span>
  </span>;
}
