/**
 * Loading state for the listing import: a little house that keeps getting
 * built — foundation, walls, roof, door and windows, then smoke from the
 * chimney — on a loop, with a headline for the current step underneath.
 * Styles live in styles.css under "house loader"; the animation is off
 * when the admin prefers reduced motion (the finished house shows instead).
 */
export function HouseLoader({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="house-loader" role="status" aria-live="polite">
      <svg className="house" viewBox="0 0 120 100" aria-hidden="true">
        <line className="h-ground" x1="8" y1="90" x2="112" y2="90" />
        <rect className="h-found" x="24" y="84" width="72" height="6" rx="1" />
        <rect className="h-walls" x="30" y="50" width="60" height="34" />
        <g className="h-roof">
          <rect x="78" y="26" width="8" height="18" />
          <polygon points="22,52 60,20 98,52" />
        </g>
        <g className="h-fit">
          <rect className="h-door" x="54" y="64" width="12" height="20" rx="1" />
          <rect className="h-window" x="37" y="58" width="11" height="10" rx="1" />
          <rect className="h-window" x="72" y="58" width="11" height="10" rx="1" />
        </g>
        <g className="h-smoke">
          <circle cx="82" cy="20" r="2.5" />
          <circle cx="86" cy="14" r="3" />
          <circle cx="83" cy="7" r="3.5" />
        </g>
      </svg>
      <p className="house-label">
        <span className="house-dots">{label}</span>
      </p>
      {hint && (
        <p className="note-line" style={{ margin: 0 }}>
          {hint}
        </p>
      )}
    </div>
  );
}
