import { RequestLog, type RequestLogEntry } from '@/api/log';

const entry = (id: string): RequestLogEntry => ({
  id,
  method: 'GET',
  url: `http://localhost:8000/${id}`,
  attempt: 1,
  status: 200,
  latencyMs: 5,
  ok: true,
  startedAt: 0,
});

describe('RequestLog', () => {
  it('keeps the newest entry first', () => {
    const log = new RequestLog();
    log.push(entry('a'));
    log.push(entry('b'));

    expect(log.getSnapshot().map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('drops the oldest entries past its cap', () => {
    const log = new RequestLog(3);
    ['a', 'b', 'c', 'd'].forEach((id) => log.push(entry(id)));

    expect(log.getSnapshot().map((e) => e.id)).toEqual(['d', 'c', 'b']);
  });

  it('hands out a new snapshot reference per push, so React re-renders', () => {
    const log = new RequestLog();
    const before = log.getSnapshot();
    log.push(entry('a'));

    expect(log.getSnapshot()).not.toBe(before);
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const log = new RequestLog();
    const listener = jest.fn();
    const unsubscribe = log.subscribe(listener);

    log.push(entry('a'));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    log.push(entry('b'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clears and notifies', () => {
    const log = new RequestLog();
    const listener = jest.fn();
    log.push(entry('a'));
    log.subscribe(listener);

    log.clear();

    expect(log.getSnapshot()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
