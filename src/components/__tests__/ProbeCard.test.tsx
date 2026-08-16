import { render, screen } from '@testing-library/react-native';
import type { ProbeResult } from '@/api/system';
import { ProbeCard } from '@/components/ProbeCard';

const upResult: ProbeResult = {
  name: 'healthz',
  path: '/healthz',
  ok: true,
  httpStatus: 200,
  latencyMs: 42,
  body: { status: 'ok' },
  checkedAt: Date.now(),
};

describe('ProbeCard', () => {
  it('shows the endpoint it calls', () => {
    render(<ProbeCard name="healthz" result={upResult} />);
    expect(screen.getByTestId('probe-path-healthz')).toHaveTextContent('GET /healthz');
  });

  it('renders an up probe with its status, latency and body', () => {
    render(<ProbeCard name="healthz" result={upResult} />);

    expect(screen.getByTestId('probe-status-healthz')).toHaveTextContent('up');
    expect(screen.getByTestId('probe-http-healthz')).toHaveTextContent('HTTP 200');
    expect(screen.getByTestId('probe-latency-healthz')).toHaveTextContent('42 ms');
    expect(screen.getByTestId('probe-body-healthz')).toHaveTextContent('{"status":"ok"}');
    expect(screen.queryByTestId('probe-error-healthz')).toBeNull();
  });

  it('renders a down probe with the reason and no body', () => {
    render(
      <ProbeCard
        name="readyz"
        result={{
          name: 'readyz',
          path: '/readyz',
          ok: false,
          httpStatus: 503,
          latencyMs: 12,
          checkedAt: Date.now(),
          error: { kind: 'http', message: 'The API answered 503.' },
        }}
      />,
    );

    expect(screen.getByTestId('probe-status-readyz')).toHaveTextContent('down');
    expect(screen.getByTestId('probe-error-readyz')).toHaveTextContent('The API answered 503.');
    expect(screen.queryByTestId('probe-body-readyz')).toBeNull();
  });

  it('shows a spinner instead of a stale verdict on the very first check', () => {
    render(<ProbeCard name="healthz" isFetching />);

    expect(screen.queryByTestId('probe-status-healthz')).toBeNull();
    expect(screen.queryByTestId('probe-http-healthz')).toBeNull();
  });

  it('labels the status for screen readers, not just by colour', () => {
    render(<ProbeCard name="healthz" result={upResult} />);
    expect(screen.getByLabelText('Status: up')).toBeTruthy();
  });
});
