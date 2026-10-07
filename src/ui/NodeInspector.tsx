import { useApp } from '../app/store';
import { nodeLabel, setNodeKind, setPedCrossing, setPedPhase } from '../net';
import type { NetNode, NodeKind, RoadNetwork } from '../sim/types';
import { Field, Row, SectionHead, Segmented, Stepper, Switch } from './controls';
import { SignalPlanEditor } from './SignalPlanEditor';
import { commitEdit, tryEdit } from './uiStore';

type EditableKind = Exclude<NodeKind, 'boundary'>;
const KIND_LABEL: Record<EditableKind, string> = { signal: 'Signal', priority: 'Priority', roundabout: 'Roundabout' };

export function NodeInspector({ node }: { node: NetNode }) {
  const network = useApp((s) => s.network);
  const label = nodeLabel(network, node.id);
  const plan = network.signals.find((p) => p.nodeId === node.id);
  const legs = network.edges.filter((e) => e.to === node.id).length;
  const edit = (fn: () => RoadNetwork, what: string) => tryEdit(() => commitEdit(fn(), `${label}: ${what}`));

  if (node.kind === 'boundary') {
    return (
      <div className="inspector-body">
        <header className="inspector-title">
          <h2>{label}</h2>
          <p className="muted">Boundary node. Trips enter and leave the network here.</p>
        </header>
        <dl className="readout">
          <Row label="Zones">{network.zones.filter((z) => z.nodes.includes(node.id)).map((z) => z.name).join(', ') || '–'}</Row>
          <Row label="Approaches">{legs}</Row>
        </dl>
      </div>
    );
  }

  return (
    <div className="inspector-body">
      <header className="inspector-title">
        <h2>{label}</h2>
        <p className="muted mono">
          {legs} approach{legs === 1 ? '' : 'es'} · {KIND_LABEL[node.kind]}
        </p>
      </header>

      <SectionHead>Control</SectionHead>
      <Segmented<EditableKind>
        label="Junction control"
        value={node.kind}
        options={(Object.keys(KIND_LABEL) as EditableKind[]).map((k) => ({ value: k, label: KIND_LABEL[k], title: k === 'roundabout' ? 'Roundabout (U)' : undefined }))}
        onChange={(k) => edit(() => setNodeKind(network, node.id, k), `control changed to ${KIND_LABEL[k].toLowerCase()}`)}
      />

      {node.kind === 'signal' && plan && <SignalPlanEditor plan={plan} label={label} />}
      {node.kind === 'signal' && !plan && <p className="msg">No signal plan yet. Switch control to Priority and back to Signal to generate one.</p>}
      {node.kind !== 'signal' && (
        <p className="muted small">
          {node.kind === 'roundabout'
            ? 'Entering traffic yields to circulating traffic. No signal plan.'
            : 'Minor approaches yield to the major road. No signal plan.'}{' '}
          <button type="button" className="link" onClick={() => edit(() => setNodeKind(network, node.id, 'signal'), 'signalized')}>
            Signalize
          </button>
        </p>
      )}

      <SectionHead>Pedestrians</SectionHead>
      <div className="form-grid">
        <Field label="Crossing">
          {() => (
            <Switch
              label="Pedestrian crossing"
              checked={!!node.pedCrossing}
              onChange={(on) =>
                edit(() => {
                  let n = setPedCrossing(network, node.id, on);
                  if (node.kind === 'signal') n = setPedPhase(n, node.id, on ? 12 : 0);
                  return n;
                }, on ? 'added pedestrian crossing' : 'removed pedestrian crossing')
              }
            />
          )}
        </Field>
        {node.kind === 'signal' && plan && (
          <Field label="Ped phase" hint="Exclusive walk phase each cycle">
            {() => (
              <Stepper
                label="pedestrian phase"
                value={plan.pedPhase}
                min={0}
                max={40}
                step={2}
                unit="s"
                onChange={(v) => edit(() => setPedPhase(network, node.id, v), `ped phase ${v} s`)}
              />
            )}
          </Field>
        )}
      </div>
    </div>
  );
}
