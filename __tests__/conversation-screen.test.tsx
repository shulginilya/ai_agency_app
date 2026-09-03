import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { requestLog } from '@/api/log';
import { Conversation } from '@/screens/Conversation';
import { agentInfo, messageResponse, runResponse, sessionInfo } from '@/test-utils/fixtures';
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

/**
 * The roster the team picker is built from. There is no teams endpoint — the
 * names come from `AgentInfo.team`, so a screen test that stubs sessions but
 * not agents would render a picker with nothing in it.
 */
const ROSTER = {
  agents: [
    agentInfo({ id: 'researcher', name: 'researcher' }),
    agentInfo({ id: 'planner', name: 'planner', availability: 'team', team: 'engineering' }),
    agentInfo({
      id: 'builder',
      name: 'builder',
      status: 'running',
      description: 'Writes the code the planner scoped.',
      availability: 'team',
      team: 'engineering',
    }),
    agentInfo({ id: 'scribe', name: 'scribe', availability: 'team', team: 'docs' }),
  ],
  count: 4,
};

/** The team picker lives behind a button now — every team test opens it first. */
async function openTeamSheet() {
  fireEvent.press(screen.getByTestId('team-button'));
  // The sheet is built from the roster query, so wait for that, not the sheet.
  await waitFor(() => expect(screen.getByTestId('team-engineering')).toBeTruthy());
}

const sessionApi =
  (turn: () => Response = () => fakeResponse({ body: messageResponse() })): Handler =>
  (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/v1/agents') return fakeResponse({ body: ROSTER });
    if (path === '/v1/sessions' && init?.method === 'POST') return fakeResponse({ status: 201, body: sessionInfo() });
    if (path.endsWith('/messages')) return turn();
    if (init?.method === 'DELETE') return fakeResponse({ status: 204 });
    return fakeResponse({ status: 404, body: { detail: 'Not Found' } });
  };

/** The body of the nth matching request, parsed. */
function bodyOfCall(fetchMock: jest.Mock, predicate: (path: string, init?: RequestInit) => boolean) {
  const call = fetchMock.mock.calls.find(([url, init]) =>
    predicate(new URL(url as string).pathname, init as RequestInit | undefined),
  );
  return call ? JSON.parse((call[1] as RequestInit).body as string) : undefined;
}

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

  it('collapses the control bar once a session exists, because the server fixed those options', async () => {
    stub(sessionApi());
    renderWithQuery(<Conversation />);

    expect(screen.getByTestId('control-bar')).toBeTruthy();

    type('go');

    // Mode and profile are gone rather than merely disabled: neither can change
    // while the session lives, and the transcript wants the room.
    await waitFor(() => expect(screen.getByTestId('session-bar')).toBeTruthy());
    expect(screen.queryByTestId('control-bar')).toBeNull();
    expect(screen.queryByTestId('profile-button')).toBeNull();
    expect(screen.queryByTestId('mode-run')).toBeNull();
    expect(screen.getByTestId('session-summary')).toHaveTextContent(/server default/);
  });

  it('keeps the chosen profile on the summary line while the session holds it', async () => {
    stub(sessionApi());
    renderWithQuery(<Conversation />);

    fireEvent.press(screen.getByTestId('profile-button'));
    await waitFor(() => expect(screen.getByTestId('profile-sheet')).toBeTruthy());
    fireEvent.press(screen.getByTestId('profile-sandboxed'));

    // Picking closes the sheet, and the button says what is set.
    await waitFor(() => expect(screen.getByTestId('profile-button')).toHaveTextContent(/sandboxed/));

    type('go');

    await waitFor(() => expect(screen.getByTestId('session-summary')).toHaveTextContent(/sandboxed/));
  });

  it('offers every team the roster names, plus solo', async () => {
    stub(sessionApi());
    renderWithQuery(<Conversation />);

    await openTeamSheet();

    expect(screen.getByTestId('team-engineering')).toBeTruthy();
    expect(screen.getByTestId('team-docs')).toBeTruthy();
    expect(screen.getByTestId('team-solo')).toBeTruthy();
    // `researcher` is an `always` agent and names no team, so it is not one.
    expect(screen.queryByTestId('team-researcher')).toBeNull();
  });

  it('shows who is on a team, not just how many, and how many are running', async () => {
    stub(sessionApi());
    renderWithQuery(<Conversation />);

    await openTeamSheet();

    expect(screen.getByTestId('team-meta-engineering')).toHaveTextContent(/2 workers · 1 running now/);
    expect(screen.getByTestId('team-member-planner')).toBeTruthy();
    expect(screen.getByTestId('team-member-builder')).toHaveTextContent(/Writes the code the planner scoped\./);
    expect(screen.getByTestId('team-member-meta-builder')).toHaveTextContent(/sonnet · 2 tools · 3 invocations/);
    // The `always` agents are listed apart: they come along whichever team runs.
    expect(screen.getByTestId('team-sheet-always')).toBeTruthy();
    expect(screen.getByTestId('team-member-researcher')).toBeTruthy();
  });

  it('opens a worker from the sheet instead of making you find it on the Agents tab', async () => {
    stub(sessionApi());
    renderWithQuery(<Conversation />);

    await openTeamSheet();
    fireEvent.press(screen.getByTestId('team-member-builder'));

    expect(router.push).toHaveBeenCalledWith('/agent/builder');
    // Navigating dismisses the sheet — coming back should not land behind it.
    await waitFor(() => expect(screen.queryByTestId('team-sheet')).toBeNull());
  });

  it('summarises the picked team on the button, so the sheet is not the only place to look', async () => {
    stub(sessionApi());
    renderWithQuery(<Conversation />);

    await openTeamSheet();
    fireEvent.press(screen.getByTestId('team-engineering'));

    await waitFor(() => expect(screen.getByTestId('team-button')).toHaveTextContent(/engineering/));
    expect(screen.getByTestId('team-button-meta')).toHaveTextContent(/2w/);
    expect(screen.getByTestId('team-button-running')).toBeTruthy();
  });

  it('opens the session as the team you picked', async () => {
    const fetchMock = stub(sessionApi());
    renderWithQuery(<Conversation />);

    await openTeamSheet();
    fireEvent.press(screen.getByTestId('team-engineering'));
    type('go');

    await waitFor(() => expect(screen.getByText('Four leads, ranked.')).toBeTruthy());
    expect(bodyOfCall(fetchMock, (path, init) => path === '/v1/sessions' && init?.method === 'POST')).toEqual({
      team: 'engineering',
    });
  });

  it('closes the open session when you pick a different team, because team is fixed at open time', async () => {
    const fetchMock = stub(sessionApi());
    renderWithQuery(<Conversation />);

    await openTeamSheet();
    fireEvent.press(screen.getByTestId('team-sheet-close'));
    type('go');
    await waitFor(() => expect(screen.getByTestId('session-status')).toBeTruthy());

    await openTeamSheet();
    // The sheet warns before you press, because this is a destructive pick.
    expect(screen.getByTestId('team-sheet-warning')).toBeTruthy();
    fireEvent.press(screen.getByTestId('team-docs'));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            new URL(url as string).pathname === '/v1/sessions/sess_1' &&
            (init as RequestInit | undefined)?.method === 'DELETE',
        ),
      ).toBe(true),
    );
    // The handle is gone, so the screen is back to advertising the open route.
    await waitFor(() => expect(screen.queryByTestId('session-status')).toBeNull());
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
    // Wait for the turn to land, not just for the button: closing mid-turn is a
    // different scenario, and the one below covers it.
    await waitFor(() => expect(screen.getByText('Four leads, ranked.')).toBeTruthy());

    fireEvent.press(screen.getByTestId('close-session'));

    await waitFor(() => expect(screen.queryByTestId('close-session')).toBeNull(), { timeout: 3000 });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/sessions/sess_1'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('stays closed when the turn that was still in flight comes back', async () => {
    stub(sessionApi());
    renderWithQuery(<Conversation />);

    type('go');
    // The button appears as soon as the session opens — the turn is still in
    // flight behind it. Its reply must not hand the closed handle back.
    await waitFor(() => expect(screen.getByTestId('close-session')).toBeTruthy());
    fireEvent.press(screen.getByTestId('close-session'));

    await waitFor(() => expect(screen.getByText('Four leads, ranked.')).toBeTruthy());
    // The DELETE and the turn are in flight together; either can land first.
    await waitFor(() => expect(screen.queryByTestId('session-status')).toBeNull(), { timeout: 3000 });
    expect(screen.queryByTestId('close-session')).toBeNull();
  });

  it('refuses an over-long prompt here rather than spending a 422 to find out', () => {
    stub(sessionApi());
    renderWithQuery(<Conversation />);

    fireEvent.changeText(screen.getByTestId('composer-input'), 'x'.repeat(20_001));

    expect(screen.getByTestId('prompt-too-long')).toBeTruthy();
    expect(screen.getByTestId('composer-send')).toBeDisabled();
  });
});
