import { TripwireRow } from '@/components/thesis/TripwireRow';
import { Code, Prose, Term, Value } from '@/components/prose/emphasis';
import type { HealthDriver } from '@/thesis/types';
import {
  EVENT_BREAKER,
  EVENT_EVALUATION,
  NVDA_BREAKERS,
  NVDA_LIVE,
  NVDA_SCENARIO,
} from '@/lib/fixtures/nvda';

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <p className="text-meta uppercase tracking-[0.14em] text-faint">{title}</p>
      {note ? <div className="mt-1.5">{note}</div> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function TripwiresLabPage() {
  const byId = (id: string) => NVDA_BREAKERS.breakers.find((b) => b.id === id)!;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-meta uppercase tracking-[0.14em] text-faint">Component lab</p>
      <h1 className="mt-1 text-xl font-medium">Tripwire row</h1>
      <Prose className="mt-2 text-sm">
        The row exists to carry <Term>headroom</Term>, not a boolean.{' '}
        <Value>4.98</Value> points from the threshold and <Value>25.6</Value> points from it are
        different situations, and a green tick renders them identically.
      </Prose>

      <Section
        title="Live"
        note={
          <Prose className="text-sm">
            Evaluated against current data. <Code>holding</Code> takes no colour — it is the default
            state and colouring it would make every screen loud.
          </Prose>
        }
      >
        {NVDA_LIVE.map((evaluation) => (
          <TripwireRow
            key={evaluation.breakerId}
            breaker={byId(evaluation.breakerId)}
            evaluation={evaluation}
          />
        ))}
        <TripwireRow breaker={EVENT_BREAKER} evaluation={EVENT_EVALUATION} />
      </Section>

      <Section
        title="Scenario — gross margin 62%, revenue growth 15%"
        note={
          <Prose className="text-sm">
            The same breakers, same evaluator, hypothetical inputs.{' '}
            <Term>Both fundamental tripwires trip together</Term> because they read the same filing
            — one event, not two independent confirmations.
          </Prose>
        }
      >
        {NVDA_SCENARIO.map((evaluation) => (
          <TripwireRow
            key={evaluation.breakerId}
            breaker={byId(evaluation.breakerId)}
            evaluation={evaluation}
          />
        ))}
      </Section>

      <Section
        title="Unrecovered — broken, but back inside its line"
        note={
          <Prose className="text-sm">
            The status says <Code>holding</Code>; the health says <Term>broken</Term>. This is the
            only place the two disagree, and the row leads with health — a muted grey
            &ldquo;Not happened&rdquo; under a thesis marked broken is the screen contradicting
            itself. It fired at <Value>69.2</Value>, is back at <Value>70.4</Value>, and half a
            typical move here is <Value>7</Value> points.
          </Prose>
        }
      >
        <TripwireRow
          breaker={byId('B1')}
          evaluation={{
            breakerId: 'B1',
            mode: 'live',
            status: 'holding',
            metric: 'grossMargin',
            observed: 70.4,
            threshold: 70,
            headroom: 0.4,
            period: '2026-07-26',
            asOf: '2026-08-26',
          }}
          trend={
            {
              breakerId: 'B1',
              metric: 'grossMargin',
              observed: 70.4,
              threshold: 70,
              headroom: 0.4,
              previousHeadroom: -0.8,
              holdingFor: 1,
              basis: 'unrecovered',
            } satisfies HealthDriver
          }
        />
      </Section>

      <Section
        title="Approaching — a full typical move, and still healthy"
        note={
          <Prose className="text-sm">
            Closed <Value>7.2</Value> points in one check, which is a full typical move — and it is
            still <Value>25.6</Value> points clear of the line.{' '}
            <Term>The move is shown; the verdict does not change.</Term> Health is a state, movement
            is an event, and collapsing the two is what made the feed chatter.
          </Prose>
        }
      >
        <TripwireRow
          breaker={byId('B1')}
          evaluation={{
            breakerId: 'B1',
            mode: 'live',
            status: 'holding',
            metric: 'grossMargin',
            observed: 95.6,
            threshold: 70,
            headroom: 25.6,
            period: '2026-07-26',
            asOf: '2026-08-26',
          }}
          trend={
            {
              breakerId: 'B1',
              metric: 'grossMargin',
              observed: 95.6,
              threshold: 70,
              headroom: 25.6,
              previousHeadroom: 32.8,
              holdingFor: 9,
              basis: 'approaching',
            } satisfies HealthDriver
          }
        />
      </Section>

      <Section
        title="Not yet evaluated"
        note={
          <Prose className="text-sm">
            Generated but not run. Distinct from <Code>holding</Code>, and never shown as safe.
          </Prose>
        }
      >
        <TripwireRow breaker={byId('B1')} />
      </Section>
    </main>
  );
}
