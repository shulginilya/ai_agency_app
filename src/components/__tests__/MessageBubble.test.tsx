import { render, screen } from '@testing-library/react-native';
import { MessageBubble } from '@/components/MessageBubble';
import type { TranscriptEntry } from '@/chat/transcript';
import { runResponse } from '@/test-utils/fixtures';

const BASE: TranscriptEntry = {
  id: 'm1',
  role: 'user',
  content: 'summarise the leads',
  created_at: '2026-08-21T09:00:00.000Z',
};

describe('MessageBubble', () => {
  it('labels who said what, so the thread reads without colour', () => {
    render(<MessageBubble entry={BASE} />);
    expect(screen.getByLabelText('You: summarise the leads')).toBeTruthy();

    render(<MessageBubble entry={{ ...BASE, id: 'm2', role: 'agent', content: 'Four leads.' }} />);
    expect(screen.getByLabelText('Agent: Four leads.')).toBeTruthy();
  });

  it('renders a system event as plain narration, not as a voice', () => {
    render(<MessageBubble entry={{ ...BASE, role: 'system', content: 'Session closed.' }} />);

    expect(screen.getByTestId('message-m1')).toHaveTextContent('Session closed.');
    expect(screen.queryByLabelText(/^Agent:/)).toBeNull();
  });

  it('marks a line whose request is still in flight', () => {
    render(<MessageBubble entry={{ ...BASE, pending: true }} />);
    expect(screen.getByTestId('message-pending-m1')).toHaveTextContent('sending…');
  });

  it('leaves the timestamp out rather than printing "Invalid Date"', () => {
    render(<MessageBubble entry={{ ...BASE, created_at: 'not a date' }} />);
    expect(screen.getByTestId('message-m1')).not.toHaveTextContent(/Invalid/);
  });

  it('puts the run underneath the reply — what it cost, and what it touched', () => {
    render(
      <MessageBubble
        entry={{
          ...BASE,
          role: 'agent',
          content: 'Four leads.',
          turn: 2,
          run: runResponse({ delegated_to: ['researcher'], tools_used: ['Read', 'Grep'] }),
        }}
      />,
    );

    expect(screen.getByTestId('run-headline-m1')).toHaveTextContent(/4\.2s/);
    expect(screen.getByTestId('run-headline-m1')).toHaveTextContent(/\$0\.0042/);
    expect(screen.getByTestId('run-headline-m1')).toHaveTextContent(/→ researcher/);
    expect(screen.getByTestId('run-tools-m1')).toHaveTextContent(/Read, Grep/);
  });

  it('says an agent-side failure out loud, since the HTTP status will not', () => {
    render(
      <MessageBubble
        entry={{
          ...BASE,
          role: 'agent',
          content: 'Tool call denied.',
          failed: true,
          run: runResponse({
            is_error: true,
            tool_events: [{ tool: 'Bash', phase: 'blocked', at: '2026-08-21T09:00:01.000Z' }],
          }),
        }}
      />,
    );

    expect(screen.getByTestId('message-failed-m1')).toHaveTextContent('The agent reported an error');
    expect(screen.getByTestId('run-blocked-m1')).toHaveTextContent(/Bash blocked/);
  });

  it('leaves the trace off a line that has no run behind it', () => {
    render(<MessageBubble entry={BASE} />);
    expect(screen.queryByTestId('run-headline-m1')).toBeNull();
  });
});
