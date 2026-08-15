import { render, screen } from '@testing-library/react-native';
import type { RequestLogEntry } from '@/api/log';
import { formatTime, pathOf, RequestLogRow } from '@/components/RequestLogRow';

const entry = (overrides: Partial<RequestLogEntry> = {}): RequestLogEntry => ({
  id: 'r1',
  method: 'GET',
  url: 'http://localhost:8000/healthz',
  attempt: 1,
  status: 200,
  latencyMs: 12,
  ok: true,
  startedAt: new Date('2026-08-15T10:20:30').getTime(),
  ...overrides,
});

describe('pathOf', () => {
  it('strips the origin', () => {
    expect(pathOf('http://localhost:8000/healthz')).toBe('/healthz');
    expect(pathOf('https://api.example.com/agents?limit=1')).toBe('/agents?limit=1');
  });

  it('leaves a non-absolute url alone', () => {
    expect(pathOf('/healthz')).toBe('/healthz');
  });
});

describe('formatTime', () => {
  it('formats as zero-padded local time', () => {
    expect(formatTime(new Date('2026-08-15T09:05:03').getTime())).toBe('09:05:03');
  });
});

describe('RequestLogRow', () => {
  it('shows the call, its latency and its status', () => {
    render(<RequestLogRow entry={entry()} />);

    expect(screen.getByText('/healthz')).toBeTruthy();
    expect(screen.getByText('GET')).toBeTruthy();
    expect(screen.getByText('12ms')).toBeTruthy();
    expect(screen.getByText('200')).toBeTruthy();
  });

  it('shows the error kind instead of a status when the call failed', () => {
    render(<RequestLogRow entry={entry({ ok: false, status: undefined, errorKind: 'network' })} />);
    expect(screen.getByText('network')).toBeTruthy();
  });

  it('falls back to a generic label when the failure has no kind', () => {
    render(<RequestLogRow entry={entry({ ok: false, status: undefined, errorKind: undefined })} />);
    expect(screen.getByText('error')).toBeTruthy();
  });

  it('marks retries', () => {
    render(<RequestLogRow entry={entry({ attempt: 2 })} />);
    expect(screen.getByText('/healthz (retry 1)')).toBeTruthy();
  });
});
