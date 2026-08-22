import {
  agentEntry,
  blockedEvents,
  drop,
  formatCost,
  formatDuration,
  isAwaitingReply,
  runHeadline,
  settle,
  systemEntry,
  toolsUsed,
  userEntry,
} from '@/chat/transcript';
import { runResponse } from '@/test-utils/fixtures';

const at = () => new Date('2026-08-21T09:00:00.000Z');

describe('entries', () => {
  it('marks the user line as in flight until it is settled', () => {
    const mine = userEntry('rank the leads', at);
    expect(mine).toMatchObject({ role: 'user', content: 'rank the leads', pending: true });

    expect(settle([mine], mine.id)[0].pending).toBe(false);
    expect(settle([mine], 'someone-else')[0].pending).toBe(true);
  });

  it('gives every entry its own id, so two identical prompts are two bubbles', () => {
    expect(userEntry('go', at).id).not.toBe(userEntry('go', at).id);
  });

  it('stamps entries with the wall clock when nobody passes one in', () => {
    // The clock is injectable for the assertions above; production passes
    // nothing, so the default has to actually work.
    const before = Date.now();
    const stamps = [userEntry('go'), agentEntry(runResponse()), systemEntry('Session closed.')].map((entry) =>
      Date.parse(entry.created_at),
    );

    for (const stamp of stamps) {
      expect(stamp).toBeGreaterThanOrEqual(before);
      expect(Number.isNaN(stamp)).toBe(false);
    }
  });

  it('renders the run output as the agent line', () => {
    const entry = agentEntry(runResponse(), { turn: 2, now: at });
    expect(entry).toMatchObject({ role: 'agent', content: 'Four leads, ranked.', turn: 2, failed: false });
  });

  it('falls back to the summary when the run produced no output', () => {
    // An error run usually has `output: null`, and an empty bubble tells you
    // nothing about what happened.
    const entry = agentEntry(runResponse({ output: null, summary: 'The agent loop failed.' }), { now: at });
    expect(entry.content).toBe('The agent loop failed.');
  });

  it('says so rather than showing nothing when there is neither', () => {
    const entry = agentEntry(runResponse({ output: '   ', summary: '' }), { now: at });
    expect(entry.content).toMatch(/without producing any output/);
  });

  it('carries is_error through as a failure, still on a 200', () => {
    expect(agentEntry(runResponse({ is_error: true }), { now: at }).failed).toBe(true);
  });

  it('rolls a failed send back out of the thread', () => {
    const mine = userEntry('go', at);
    const other = systemEntry('Session opened.', at);
    expect(drop([other, mine], mine.id)).toEqual([other]);
  });

  it('knows when a reply is still owed', () => {
    const mine = userEntry('go', at);
    expect(isAwaitingReply([mine])).toBe(true);
    expect(isAwaitingReply(settle([mine], mine.id))).toBe(false);
    expect(isAwaitingReply([])).toBe(false);
  });
});

describe('formatting', () => {
  it('scales the duration to something readable', () => {
    expect(formatDuration(420)).toBe('420 ms');
    expect(formatDuration(4_200)).toBe('4.2s');
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(Number.NaN)).toBe('—');
  });

  it('does not round a sub-cent run down to "free"', () => {
    expect(formatCost(0)).toBe('$0');
    expect(formatCost(0.0042)).toBe('$0.0042');
    expect(formatCost(1.239)).toBe('$1.24');
  });

  it('puts the cost of a turn in one line', () => {
    expect(runHeadline(runResponse())).toBe('2 turns · 4.2s · $0.0042 · claude-sonnet-4-6');
  });

  it('names the workers a team run delegated to', () => {
    expect(runHeadline(runResponse({ delegated_to: ['researcher', 'reviewer'] }))).toContain('→ researcher, reviewer');
  });

  it('singularises a one-turn run', () => {
    expect(runHeadline(runResponse({ num_turns: 1 }))).toContain('1 turn ·');
  });
});

describe('the tool trace', () => {
  it('dedupes tools across tools_used and the event stream, keeping first-use order', () => {
    const run = runResponse({
      tools_used: ['Read'],
      tool_events: [
        { tool: 'Read', phase: 'pre', at: '' },
        { tool: 'Bash', phase: 'pre', at: '' },
        { tool: 'Bash', phase: 'post', at: '' },
      ],
    });

    expect(toolsUsed(run)).toEqual(['Read', 'Bash']);
  });

  it('surfaces only the events worth surfacing — denials and failures', () => {
    const run = runResponse({
      tool_events: [
        { tool: 'Read', phase: 'post', at: '' },
        { tool: 'Bash', phase: 'blocked', at: '' },
        { tool: 'Write', phase: 'failed', at: '' },
      ],
    });

    expect(blockedEvents(run).map((event) => event.tool)).toEqual(['Bash', 'Write']);
  });
});
