export function CoachCard() {
  return (
    <div className="coach panel" role="note">
      <ol>
        <li>
          <span className="mono">1</span> Run the baseline.
        </li>
        <li>
          <span className="mono">2</span> Change the infrastructure.
        </li>
        <li>
          <span className="mono">3</span> Compare.
        </li>
      </ol>
      <p className="muted small">
        Press <kbd>Space</kbd> to start. Pick a tool on the left to edit roads and junctions.
      </p>
    </div>
  );
}
