import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";

/**
 * Placeholder for a destination a later phase fills in. Names the phase
 * explicitly so a stakeholder clicking around a demo knows the difference
 * between "not built yet" and "broken".
 */
export function PhaseStub({
  title,
  phase,
  summary,
  willInclude,
}: {
  title: string;
  phase: number;
  summary: string;
  willInclude: string[];
}) {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl text-ink">{title}</h1>
          <Badge variant="navy">Phase {phase}</Badge>
        </div>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">{summary}</p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Arriving in Phase {phase}</CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="space-y-2 text-sm text-ink-muted">
            {willInclude.map((item) => (
              <li key={item} className="flex gap-3">
                <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-ink-subtle" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
