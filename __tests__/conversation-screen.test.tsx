import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { requestLog } from '@/api/log';
import { Conversation } from '@/screens/Conversation';
import { messageResponse, runResponse, sessionInfo } from '@/test-utils/fixtures';
import { fakeResponse } from '@/test-utils/http';
import { renderWithQuery } from '@/test-utils/render';

/**
 * Integration test for the conversation: the real screen, the real hook, the
 * real client — only `fetch` is stubbed.
 */
type Handler = (url: string, init?: RequestInit) => Response;

function stub(handler: Handler) {
  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => handler(url, init));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const sessionApi =
  (turn: () => Response = () => fakeResponse({ body: messageResponse() })): Handler =>
  (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/v1/sessions' && init?.method === 'POST') return fakeResponse({ status: 201, body: sessionInfo() });
    if (path.endsWith('/messages')) return turn();
    if (init?.method === 'DELETE') return fakeResponse({ status: 204 });
    return fakeResponse({ status: 404, body: { detail: 'Not Found' } });
  };

function type(text: string) {
  fireEvent.changeText(screen.getByTestId('composer-input'), text);
  fireEvent.press(screen.getByTestId('composer-send'));
}

beforeEach(() => requestLog.clear());

describe('Conversation screen', () => {
  it('starts empty and pointed at the session route', () => {
    stub(sessionApi());
    renderWithQuery(<Conversation />);

    expect(screen.getByTestId('chat-empty')).toBeTruthy();
    expect(screen.getByTestId('conversation-target')).toHaveTextContent(/POST \/v1\/sessions/);
  });

  it('opens a session on send and shows the finished turn', async () => {
    stub(sessionApi());
    renderWithQuery(<Conversation />);

    type('rank the leads');

    await waitFor(() => expect(screen.getByText('Four leads, ranked.')).toBeTruthy());
    expect(screen.getByTestId('conversation-target')).toHaveTextContent(/sess_1/);
    expect(screen.getByTestId('session-status')).toHaveTextContent('idle');
  });

  it('locks profile and team once a session exists, because the server fixed them', async () => {
    stub(sessionApi());
    renderWithQuery(<Conversation />);

    expect(screen.getByTestId('toggle-team')).toBeEnabled();

    type('go');

    await waitFor(() => expect(screen.getByTestId('toggle-team')).toBeDisabled());
    expect(screen.getByTestId('profile-dev')).toBeDisabled();
    expect(screen.getByTestId('mode-run')).toBeDisabled();
  });

  it('sends a one-shot run to /v1/runs instead, when that mode is chosen', async () => {
    const fetchMock = stub((url) =>
      new URL(url).pathname === '/v1/runs'
        ? fakeResponse({ body: runResponse({ output: 'Done.' }) })
        : fakeResponse({ status: 404, body: { detail: 'Not Found' } }),
    );
    renderWithQuery(<Conversation />);

    fireEvent.press(screen.getByTestId('mode-run'));
    type('one piece of work');

    await waitFor(() => expect(screen.getByText('Done.')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/v1/runs'), expect.anything());
    expect(screen.queryByTestId('close-session')).toBeNull();
  });

  it('puts your text back in the composer when the send fails', async () => {
    stub((url, init) => {
      const path = new URL(url).pathname;
      if (path === '/v1/sessions' && init?.method === 'POST') return fakeResponse({ status: 201, body: sessionInfo() });
      return fakeResponse({ status: 503, body: { detail: 'All run slots are in use; retry.' } });
    });
    renderWithQuery(<Conversation />);

    type('rank the leads');

    await waitFor(() => expect(screen.getByTestId('chat-send-error')).toBeTruthy());
    expect(screen.getByTestId('chat-send-error')).toHaveTextContent(/All run slots are in use/);
    expect(screen.getByTestId('composer-input').props.value).toBe('rank the leads');
  });

  it('closes the session on request', async () => {
    const fetchMock = stub(sessionApi());
    renderWithQuery(<Conversation />);

    type('go');
    await waitFor(() => expect(screen.getByTestId('close-session')).toBeTruthy());

    fireEvent.press(screen.getByTestId('close-session'));

    await waitFor(() => expect(screen.queryByTestId('close-session')).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/sessions/sess_1'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('refuses an over-long prompt here rather than spending a 422 to find out', () => {
    stub(sessionApi());
    renderWithQuery(<Conversation />);

    fireEvent.changeText(screen.getByTestId('composer-input'), 'x'.repeat(20_001));

    expect(screen.getByTestId('prompt-too-long')).toBeTruthy();
    expect(screen.getByTestId('composer-send')).toBeDisabled();
  });
});
