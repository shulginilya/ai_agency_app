import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { AgentCommand } from '@/api/agents';
import { isApiError } from '@/api/errors';
import type { AgentStatus } from '@/api/schemas';
import { MessageBubble } from '@/components/MessageBubble';
import { MessageComposer } from '@/components/MessageComposer';
import { Screen } from '@/components/Screen';
import { StatusPill, type StatusTone } from '@/components/StatusPill';
import { useAgent, useAgentCommand } from '@/hooks/useAgents';
import { useMessages, useSendMessage } from '@/hooks/useMessages';
import { radius, spacing, useTheme } from '@/theme';

const STATUS_TONE: Record<AgentStatus, StatusTone> = {
  idle: 'muted',
  starting: 'warning',
  running: 'success',
  paused: 'warning',
  error: 'danger',
  stopped: 'muted',
};

/** Which controls make sense to offer given where the agent currently is. */
const COMMANDS: { command: AgentCommand; label: string; icon: 'play' | 'pause' | 'stop'; when: AgentStatus[] }[] = [
  { command: 'start', label: 'Start', icon: 'play', when: ['idle', 'paused', 'stopped', 'error'] },
  { command: 'pause', label: 'Pause', icon: 'pause', when: ['running', 'starting'] },
  { command: 'stop', label: 'Stop', icon: 'stop', when: ['running', 'starting', 'paused'] },
];

export type AgentChatProps = {
  agentId: string;
  onBack?: () => void;
};

/**
 * Talking to one agent.
 *
 * Everything on this screen is the same API layer the control screen uses — the
 * thread is a polled `GET`, sending is a `POST` that is never auto-retried, and
 * the start/pause/stop buttons are the `commandAgent` endpoint that has been
 * sitting unused since the client was written. Nothing here touches `fetch`.
 */
export function AgentChat({ agentId, onBack }: AgentChatProps) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const agent = useAgent(agentId);
  const command = useAgentCommand();
  const { messages, isLoading, error, isAwaitingReply, replyTimedOut, refresh } = useMessages(agentId);
  const send = useSendMessage(agentId);

  // New turn, or the reply landing: keep the newest line in view.
  useEffect(() => {
    if (messages.length === 0) return;
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [messages.length, isAwaitingReply]);

  const submit = useCallback(() => {
    const content = draft.trim();
    if (!content || send.isPending) return;
    setDraft('');
    send.mutate(content, {
      // Nothing typed should ever be lost to a failed request.
      onError: () => setDraft((current) => (current.length > 0 ? current : content)),
    });
  }, [draft, send]);

  const status = agent.data?.status;
  const threadError = error && isApiError(error) ? error : undefined;
  const notImplemented = threadError?.status === 404;

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
          <View style={styles.headerTop}>
            {onBack ? (
              <Pressable
                testID="chat-back"
                accessibilityRole="button"
                accessibilityLabel="Back to agents"
                onPress={onBack}
                hitSlop={10}
              >
                <Ionicons name="chevron-back" size={24} color={colors.accent} />
              </Pressable>
            ) : null}
            <View style={styles.flex}>
              <Text testID="chat-agent-name" style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                {agent.data?.name ?? agentId}
              </Text>
              <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={1}>
                {agent.data?.description ?? agentId}
              </Text>
            </View>
            {status ? (
              <StatusPill testID="chat-agent-status" label={status} tone={STATUS_TONE[status] ?? 'muted'} />
            ) : null}
          </View>

          <View style={styles.commands}>
            {COMMANDS.map(({ command: verb, label, icon, when }) => {
              const enabled = status !== undefined && when.includes(status) && !command.isPending;
              return (
                <Pressable
                  key={verb}
                  testID={`chat-command-${verb}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${label} agent`}
                  accessibilityState={{ disabled: !enabled }}
                  disabled={!enabled}
                  onPress={() => command.mutate({ id: agentId, command: verb })}
                  style={[
                    styles.commandButton,
                    { borderColor: colors.border, opacity: enabled ? 1 : 0.4, backgroundColor: colors.background },
                  ]}
                >
                  <Ionicons name={icon} size={13} color={colors.text} />
                  <Text style={[styles.commandLabel, { color: colors.text }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          {command.error ? (
            <Text testID="chat-command-error" style={[styles.headerError, { color: colors.danger }]}>
              {isApiError(command.error) ? command.error.userMessage : 'That command did not go through.'}
            </Text>
          ) : null}
        </View>

        <ScrollView
          ref={scrollRef}
          testID="chat-thread"
          contentContainerStyle={styles.thread}
          keyboardShouldPersistTaps="handled"
        >
          {isLoading ? (
            <ActivityIndicator testID="chat-loading" color={colors.accent} style={styles.centered} />
          ) : notImplemented ? (
            <View testID="chat-not-implemented" style={[styles.notice, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={[styles.noticeTitle, { color: colors.text }]}>No messaging endpoint yet</Text>
              <Text style={[styles.noticeText, { color: colors.textMuted }]}>
                The client, schema, polling loop and this screen are already in place. Add{' '}
                <Text style={styles.code}>GET</Text> and <Text style={styles.code}>POST /agents/{agentId}/messages</Text>{' '}
                to the API and this thread fills itself in — see docs/control-plane.md for the exact shape.
              </Text>
            </View>
          ) : threadError ? (
            <View testID="chat-error" style={[styles.notice, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={[styles.noticeText, { color: colors.textMuted }]}>{threadError.userMessage}</Text>
              <Pressable testID="chat-retry" accessibilityRole="button" onPress={() => void refresh()}>
                <Text style={[styles.link, { color: colors.accent }]}>Try again</Text>
              </Pressable>
            </View>
          ) : messages.length === 0 ? (
            <Text testID="chat-empty" style={[styles.empty, { color: colors.textMuted }]}>
              Nothing here yet. Send the agent an instruction and its reply will land in this thread.
            </Text>
          ) : (
            messages.map((message) => <MessageBubble key={message.id} message={message} />)
          )}

          {isAwaitingReply ? (
            <View testID="chat-awaiting" style={styles.awaiting}>
              <ActivityIndicator size="small" color={colors.textMuted} />
              <Text style={[styles.awaitingText, { color: colors.textMuted }]}>
                {agent.data?.name ?? 'The agent'} is working…
              </Text>
            </View>
          ) : null}

          {replyTimedOut ? (
            <View testID="chat-reply-timeout" style={styles.awaiting}>
              <Text style={[styles.awaitingText, { color: colors.textMuted }]}>
                No reply yet. The agent may still be working.
              </Text>
              <Pressable testID="chat-check-again" accessibilityRole="button" onPress={() => void refresh()}>
                <Text style={[styles.link, { color: colors.accent }]}>Check again</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>

        {send.error ? (
          <Text testID="chat-send-error" style={[styles.sendError, { color: colors.danger }]}>
            {isApiError(send.error) ? send.error.userMessage : 'That message did not send.'} Your text is still in the
            box.
          </Text>
        ) : null}

        <MessageComposer
          value={draft}
          onChangeText={setDraft}
          onSend={submit}
          busy={send.isPending}
          disabled={notImplemented}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 12, fontFamily: 'monospace' },
  commands: { flexDirection: 'row', gap: spacing.sm },
  commandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  commandLabel: { fontSize: 13, fontWeight: '600' },
  headerError: { fontSize: 12 },
  thread: { padding: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 },
  centered: { marginTop: spacing.xl },
  empty: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: spacing.xxl, paddingHorizontal: spacing.lg },
  notice: {
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  noticeTitle: { fontSize: 15, fontWeight: '700' },
  noticeText: { fontSize: 13, lineHeight: 19 },
  code: { fontFamily: 'monospace' },
  link: { fontSize: 13, fontWeight: '600' },
  awaiting: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  awaitingText: { fontSize: 13 },
  sendError: { fontSize: 12, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
});
