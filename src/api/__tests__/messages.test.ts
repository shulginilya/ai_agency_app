import { HttpClient } from '@/api/http';
import { isAwaitingReply, listMessages, sendMessage, sortByTime } from '@/api/messages';
import { unwrapMessage, unwrapMessageList, type Message } from '@/api/schemas';
import { catchApiError } from '@/test-utils/expect';
import { fakeResponse, fetchSequence } from '@/test-utils/http';

const USER: Message = {
  id: 'm1',
  agent_id: 'a1',
  role: 'user',
  content: 'summarise the leads',
  created_at: '2026-08-16T09:00:00.000Z',
};

const REPLY: Message = {
  id: 'm2',
  agent_id: 'a1',
  role: 'agent',
  content: 'Four leads worth a call.',
  created_at: '2026-08-16T09:00:03.000Z',
};

function clientWith(fetchImpl: jest.Mock) {
  return new HttpClient({
    baseUrl: 'http://localhost:8000',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
  });
}

describe('listMessages', () => {
  it('accepts a bare array', async () => {
    const messages = await listMessages('a1', {
      client: clientWith(fetchSequence([fakeResponse({ body: [USER, REPLY] })])),
    });
    expect(messages).toEqual([USER, REPLY]);
  });

  it('accepts a { messages: [...] } envelope', async () => {
    const messages = await listMessages('a1', {
      client: clientWith(fetchSequence([fakeResponse({ body: { messages: [USER] } })])),
    });
    expect(messages).toEqual([USER]);
  });

  it('url-encodes the agent id and passes the cursor through', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: [] })]);

    await listMessages('a/1', { client: clientWith(fetchImpl), after: 'm7', limit: 20 });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:8000/v1/agents/a%2F1/messages?after=m7&limit=20',
      expect.anything(),
    );
  });

  it('omits query params that were not asked for', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ body: [] })]);
    await listMessages('a1', { client: clientWith(fetchImpl) });
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:8000/v1/agents/a1/messages', expect.anything());
  });

  it('rejects loudly on an unknown role rather than rendering it', async () => {
    const error = await catchApiError(
      listMessages('a1', {
        client: clientWith(fetchSequence([fakeResponse({ body: [{ ...USER, role: 'operator' }] })])),
      }),
    );

    expect(error.kind).toBe('validation');
    expect(error.issues?.join(' ')).toMatch(/^0\.role:/);
  });

  it('rejects a message with no timestamp — the thread is ordered by it', async () => {
    const { created_at: _dropped, ...withoutTime } = USER;
    const error = await catchApiError(
      listMessages('a1', { client: clientWith(fetchSequence([fakeResponse({ body: [withoutTime] })])) }),
    );

    expect(error.kind).toBe('validation');
  });

  it('surfaces the not-yet-implemented endpoint as a 404', async () => {
    const error = await catchApiError(
      listMessages('a1', {
        client: clientWith(fetchSequence([fakeResponse({ status: 404, body: { detail: 'Not Found' } })])),
      }),
    );

    expect(error.kind).toBe('http');
    expect(error.status).toBe(404);
  });
});

describe('sendMessage', () => {
  it('POSTs the content and returns the accepted message', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ status: 202, body: { message: USER } })]);

    const message = await sendMessage('a1', 'summarise the leads', { client: clientWith(fetchImpl) });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:8000/v1/agents/a1/messages',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ content: 'summarise the leads' }) }),
    );
    expect(message).toEqual(USER);
  });

  it('accepts an un-enveloped message too', async () => {
    const message = await sendMessage('a1', 'hi', {
      client: clientWith(fetchSequence([fakeResponse({ status: 202, body: USER })])),
    });
    expect(message).toEqual(USER);
  });

  it('is never replayed — a duplicate message is worse than a failed one', async () => {
    const fetchImpl = fetchSequence([fakeResponse({ status: 503, body: { detail: 'busy' } })]);

    const error = await catchApiError(sendMessage('a1', 'hi', { client: clientWith(fetchImpl) }));

    expect(error.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('isAwaitingReply', () => {
  it('is false for an empty thread', () => {
    expect(isAwaitingReply([])).toBe(false);
  });

  it('is true while the last word is yours', () => {
    expect(isAwaitingReply([USER])).toBe(true);
  });

  it('is false once the agent has answered', () => {
    expect(isAwaitingReply([USER, REPLY])).toBe(false);
  });

  it('is true when the server flagged a message as still being produced', () => {
    expect(isAwaitingReply([USER, { ...REPLY, pending: true }])).toBe(true);
  });

  it('is false when a system event is the last thing to happen', () => {
    expect(isAwaitingReply([USER, REPLY, { ...REPLY, id: 'm3', role: 'system' }])).toBe(false);
  });
});

describe('sortByTime', () => {
  it('puts the thread in order regardless of what the server sent', () => {
    expect(sortByTime([REPLY, USER]).map((message) => message.id)).toEqual(['m1', 'm2']);
  });

  it('falls back to the id when two messages share a timestamp', () => {
    const b = { ...USER, id: 'm9' };
    const a = { ...USER, id: 'm3' };
    expect(sortByTime([b, a]).map((message) => message.id)).toEqual(['m3', 'm9']);
  });

  it('does not mutate its input', () => {
    const input = [REPLY, USER];
    sortByTime(input);
    expect(input.map((message) => message.id)).toEqual(['m2', 'm1']);
  });
});

describe('envelope unwrapping', () => {
  it('flattens both envelopes and leaves bare payloads alone', () => {
    expect(unwrapMessageList({ messages: [USER] })).toEqual([USER]);
    expect(unwrapMessageList([USER])).toEqual([USER]);
    expect(unwrapMessage({ message: USER })).toEqual(USER);
    expect(unwrapMessage(USER)).toEqual(USER);
    expect(unwrapMessageList(null)).toBeNull();
  });
});
