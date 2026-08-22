import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AgentDetail } from '@/screens/AgentDetail';
import { agentInfo } from '@/test-utils/fixtures';
import { fakeResponse } from '@/test-utils/http';
import { renderWithQuery } from '@/test-utils/render';

function stub(response: () => Response) {
  const fetchMock = jest.fn(async () => response());
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('Agent detail', () => {
  it('shows what constrains the agent: model, turn cap, tools', async () => {
    stub(() => fakeResponse({ body: agentInfo() }));
    renderWithQuery(<AgentDetail agentId="researcher" />);

    await waitFor(() => expect(screen.getByTestId('detail-model')).toHaveTextContent(/sonnet/));
    expect(screen.getByTestId('detail-max-turns')).toHaveTextContent(/12/);
    expect(screen.getByTestId('detail-tool-Read')).toBeTruthy();
    expect(screen.getByTestId('detail-description')).toHaveTextContent(/background/);
  });

  it('spells out what an inherited model and inherited tools mean', async () => {
    // `null` is not "none" here: it means the agent takes the run's own.
    stub(() => fakeResponse({ body: agentInfo({ model: null, tools: null, max_turns: null }) }));
    renderWithQuery(<AgentDetail agentId="researcher" />);

    await waitFor(() => expect(screen.getByTestId('detail-tools-inherited')).toBeTruthy());
    expect(screen.getByTestId('detail-model')).toHaveTextContent(/inherits/);
    expect(screen.getByTestId('detail-max-turns')).toHaveTextContent(/default/);
  });

  it('reads "never ran" off the invocation count, not off the timestamp', async () => {
    // `updated_at` is set when the server starts observing, so it always looks
    // plausible. `invocations` is the only field that can tell you.
    stub(() => fakeResponse({ body: agentInfo({ invocations: 0 }) }));
    renderWithQuery(<AgentDetail agentId="researcher" />);

    await waitFor(() => expect(screen.getByTestId('detail-invocations')).toHaveTextContent(/never started/));
  });

  it('says how work reaches a team-only agent', async () => {
    stub(() => fakeResponse({ body: agentInfo({ availability: 'team' }) }));
    renderWithQuery(<AgentDetail agentId="planner" />);

    await waitFor(() => expect(screen.getByTestId('detail-how-to-reach')).toHaveTextContent(/Team on/));
  });

  it('offers no controls, because the API has none', async () => {
    stub(() => fakeResponse({ body: agentInfo() }));
    renderWithQuery(<AgentDetail agentId="researcher" />);

    await waitFor(() => expect(screen.getByTestId('detail-agent-name')).toBeTruthy());
    for (const label of ['Start agent', 'Pause agent', 'Stop agent']) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
  });

  it('explains a 404 as a stale id rather than as a broken server', async () => {
    stub(() => fakeResponse({ status: 404, body: { detail: 'No agent named ghost.' } }));
    renderWithQuery(<AgentDetail agentId="ghost" />);

    await waitFor(() => expect(screen.getByTestId('detail-error')).toBeTruthy());
    expect(screen.getByTestId('detail-error')).toHaveTextContent(/No agent with that id/);
  });

  it('goes back when asked', async () => {
    stub(() => fakeResponse({ body: agentInfo() }));
    const onBack = jest.fn();
    renderWithQuery(<AgentDetail agentId="researcher" onBack={onBack} />);

    fireEvent.press(screen.getByTestId('detail-back'));

    expect(onBack).toHaveBeenCalled();
  });
});
