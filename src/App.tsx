import { SceneView } from './render';
import { CompareDrawer } from './ui/CompareDrawer';
import { ConnectivityWarning } from './ui/ConnectivityWarning';
import { Dashboard } from './ui/Dashboard';
import { Inspector } from './ui/Inspector';
import { pickEdge, pickNode, pickNone } from './ui/interactions';
import { RunBar } from './ui/RunBar';
import { MapHint, ToolRail } from './ui/ToolRail';
import { TopBar } from './ui/TopBar';
import { useHotkeys } from './ui/useHotkeys';

export function App() {
  useHotkeys();
  return (
    <div className="app">
      <TopBar />
      <main className="workspace">
        <div className="map" aria-label="3D road network. Click roads and junctions to edit them.">
          <SceneView onPickEdge={pickEdge} onPickNode={pickNode} onPickNone={pickNone} />
        </div>
        <ToolRail />
        <div className="stage">
          <div className="stage-top">
            <ConnectivityWarning />
            <MapHint />
          </div>
          <RunBar />
        </div>
        <Inspector />
        <Dashboard />
        <CompareDrawer />
      </main>
    </div>
  );
}
