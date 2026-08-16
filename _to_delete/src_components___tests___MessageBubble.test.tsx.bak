import { render, screen } from '@testing-library/react-native';
import type { Message } from '@/api/schemas';
import { MessageBubble } from '@/components/MessageBubble';

const BASE: Message = {
  id: 'm1',
  agent_id: 'a1',
  role: 'user',
  content: 'summarise the leads',
  created_at: '2026-08-16T09:00:00.000Z',
};

describe('MessageBubble', () => {
  it('labels who said what, so the thread reads without colour', () => {
    render(<MessageBubble message={BASE} />);
    expect(screen.getByLabelText('You: summarise the leads')).toBeTruthy();

    render(<MessageBubble message={{ ...BASE, id: 'm2', role: 'agent', content: 'Four leads.' }} />);
    expect(screen.getByLabelText('Agent: Four leads.')).toBeTruthy();
  });

  it('renders a system event as plain narration, not as a voice', () => {
    render(<MessageBubble message={{ ...BASE, role: 'system', content: 'Agent paused.' }} />);

    expect(screen.getByTestId('message-m1')).toHaveTextContent('Agent paused.');
    expect(screen.queryByLabelText(/^Agent:/)).toBeNull();
  });

  it('marks a message the server has not acknowledged yet', () => {
    render(<MessageBubble message={{ ...BASE, pending: true }} />);
    expect(screen.getByTestId('message-pending-m1')).toHaveTextContent('sending…');
  });

  it('leaves the timestamp out rather than printing "Invalid Date"', () => {
    render(<MessageBubble message={{ ...BASE, created_at: 'not a date' }} />);
    expect(screen.getByTestId('message-m1')).not.toHaveTextContent(/Invalid/);
  });
});
