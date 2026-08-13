function Character({ className, x, y }: { className: string; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={`globe-character ${className}`}>
        <circle cx="0" cy="-7" r="6" />
        <path d="M-10 12c1-10 5-14 10-14s9 4 10 14" />
      </g>
    </g>
  );
}

export function MatchmakingGlobe() {
  return (
    <div aria-hidden="true" className="matchmaking-globe-scene">
      <svg className="matchmaking-globe" viewBox="0 0 320 230">
        <defs>
          <clipPath id="qg-matchmaking-globe-clip"><circle cx="148" cy="112" r="82" /></clipPath>
          <radialGradient id="qg-matchmaking-globe-fill" cx="36%" cy="27%" r="74%">
            <stop offset="0" stopColor="currentColor" stopOpacity=".18" />
            <stop offset="1" stopColor="currentColor" stopOpacity=".04" />
          </radialGradient>
        </defs>
        <circle className="matchmaking-globe__halo" cx="148" cy="112" r="104" />
        <circle className="matchmaking-globe__sphere" cx="148" cy="112" r="82" fill="url(#qg-matchmaking-globe-fill)" />
        <g className="matchmaking-globe__world" clipPath="url(#qg-matchmaking-globe-clip)">
          <ellipse cx="148" cy="112" rx="82" ry="31" />
          <ellipse cx="148" cy="112" rx="82" ry="61" />
          <ellipse cx="148" cy="112" rx="30" ry="82" />
          <ellipse cx="148" cy="112" rx="58" ry="82" />
          <path className="matchmaking-globe__land" d="M78 79c18-17 38-27 55-23l12 16-10 14-25 4-9 21-25-4zM169 55l31 7 20 25-13 15-18-5-10 19-20-15 8-18zM160 128l32-8 30 18-8 27-22 7-14 30-22-16-10-31zM88 137l24-12 24 10-4 22-18 7-9 23-18-18z" />
        </g>
        <g className="matchmaking-globe__people">
          <Character className="globe-character--one" x={101} y={82} />
          <Character className="globe-character--two" x={184} y={74} />
          <Character className="globe-character--three" x={118} y={151} />
          <Character className="globe-character--four" x={197} y={143} />
        </g>
        <g className="matchmaking-magnifier">
          <circle cx="0" cy="0" r="30" />
          <path d="M22 22l29 29" />
          <circle className="matchmaking-magnifier__glint" cx="-10" cy="-10" r="5" />
        </g>
      </svg>
    </div>
  );
}
