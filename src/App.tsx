import { useApp } from './app/store';
import { SceneView } from './render';
import { CompareDrawer } from './ui/CompareDrawer';
import { ConnectivityWarning } from './ui/ConnectivityWarning';
import { pickEdge, pickNode, pickNone } from './ui/interactions';
import { Legend, LiveStats } from './ui/LiveStats';
import { MapCard } from './ui/MapCard';
import { RunBar } from './ui/RunBar';
import { StepStrip } from './ui/StepStrip';
import { TestResults } from './ui/TestResults';
import { Loading, Toast } from './ui/Toast';
import { TopBar } from './ui/TopBar';
import { useHotkeys } from './ui/useHotkeys';

export function App() {
  useHotkeys();
  const ready = useApp((s) => s.network.nodes.length > 0);
  return (
    <div className="app">
      <TopBar />
      <main className="workspace">
        <div className="map" aria-label="Map of the road network. Click a road or junction to change it.">
          {ready && <SceneView onPickEdge={pickEdge} onPickNode={pickNode} onPickNone={pickNone} />}
        </div>
        <Loading />
        {ready && (
          <>
            <div className="overlay overlay-top">
              <StepStrip />
              <ConnectivityWarning />
            </div>
            <LiveStats />
            <div className="side">
              <MapCard />
              <TestResults />
            </div>
            <div className="overlay overlay-bottom">
              <Toast />
              <RunBar />
            </div>
            <Legend />
          </>
        )}
        <CompareDrawer />
      </main>
    </div>
  );
}
