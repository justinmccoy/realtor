/** Ghost layout shown while the board loads — mirrors the real card anatomy
 *  so the page doesn't reflow when data arrives. */
export function SkeletonBoard() {
  return (
    <div className="wrap" aria-busy="true" aria-label="Loading">
      <header>
        <div style={{ width: "100%" }}>
          <div className="sk sk-line" style={{ width: 180 }} />
          <div className="sk sk-title" />
        </div>
      </header>
      <div className="sk sk-bar" />
      <div className="grid">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div className="card" key={i}>
            <div className="sk sk-photo" />
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div className="sk sk-plate" />
              <div className="sk sk-pill" />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div className="sk sk-price" style={{ width: "45%" }} />
              <div className="sk sk-line" style={{ width: "22%" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
