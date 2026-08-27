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
import { describeApiError } from '@/api/errors';
import { promptTooLong } from '@/api/runs';
import { MAX_PROMPT_LENGTH, RUN_PROFILES, type RunProfile } from '@/api/schemas';
import { MessageBubble } from '@/components/MessageBubble';
import { MessageComposer } from '@/components/MessageComposer';
import { Screen } from '@/components/Screen';
import { StatusPill } from '@/components/StatusPill';
import { useConversation, type ConversationMode } from '@/hooks/useConversation';
import { useTeams } from '@/hooks/useTeams';
import { radius, spacing, useTheme } from '@/theme';

const MODES: { mode: ConversationMode; label: string; hint: string }[] = [
  { mode: 'session', label: 'Session', hint: 'Multi-turn. The agent remembers, and holds a subprocess open.' },
  { mode: 'run', label: 'One-shot', hint: 'One prompt, one answer, no memory and nothing to clean up.' },
];

/**
 * The conversation screen.
 *
 * It talks to the server, not to an agent — that distinction is the server's,
 * and pretending otherwise would be a lie the UI tells. `team` is what brings
 * the roster into it: the named team's manager runs and delegates to its
 * workers on the Agents tab, and the reply says underneath it who it handed
 * work to.
 *
 * The team names come from the roster, not from a teams endpoint — there is
 * none. See `src/api/teams.ts` for what that costs.
 *
 * Profile and team are baked into the options a session connected with, and
 * sending either on a turn is a 422. Profile therefore locks once a session is
 * open. Team does not: picking another one closes the session then and there,
 * because "switch team" with no way to switch is not a feature. The hint says
 * so before you press it, and `useConversation` closes it again as a backstop
 * if anything drives the hook past this screen.
 */
export function Conversation() {
  const { colors } = useTheme();
  const [mode, setMode] = useState<ConversationMode>('session');
  const [profile, setProfile] = useState<RunProfile | null>(null);
  const [team, setTeam] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const { teams } = useTeams();
  const conversation = useConversation({ mode, profile, team });
  const { entries, session, isSending } = conversation;
  const locked = session !== null;
  const tooLong = promptTooLong(draft);

  /**
   * Picking a team while a session is open ends that session: its team was
   * fixed when it connected. Closing here rather than on the next send means
   * the transcript says "Session closed." at the moment you pressed, instead of
   * a subprocess quietly outliving the choice.
   */
  const chooseTeam = useCallback(
    (next: string | null) => {
      if (next === team) return;
      if (session) conversation.close();
      setTeam(next);
    },
    [team, session, conversation],
  );

  // The reply lands all at once and can be long: keep the newest line in view.
  useEffect(() => {
    if (entries.length === 0) return;
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [entries.length, isSending]);

  const submit = useCallback(() => {
    const prompt = draft.trim();
    if (!prompt || isSending || promptTooLong(prompt)) return;
    setDraft('');
    conversation.send(prompt, {
      // Nothing typed should ever be lost to a failed request.
      onError: () => setDraft((current) => (current.length > 0 ? current : prompt)),
    });
  }, [draft, isSending, conversation]);

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
          <View style={styles.headerTop}>
            <View style={styles.flex}>
              <Text style={[styles.title, { color: colors.text }]}>Conversation</Text>
              <Text testID="conversation-target" style={[styles.subtitle, { color: colors.textMuted }]}>
                {session
                  ? `${session.id} · ${session.team ?? 'solo'} · ${session.turns} turn${session.turns === 1 ? '' : 's'}`
                  : mode === 'session'
                    ? 'POST /v1/sessions'
                    : 'POST /v1/runs'}
              </Text>
            </View>
            {session ? (
              <StatusPill
                testID="session-status"
                label={session.status}
                tone={session.status === 'busy' ? 'warning' : 'success'}
              />
            ) : null}
          </View>

          <View style={styles.segments}>
            {MODES.map(({ mode: value, label }) => {
              const active = mode === value;
              return (
                <Pressable
                  key={value}
                  testID={`mode-${value}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${label} mode`}
                  accessibilityState={{ selected: active, disabled: locked }}
                  disabled={locked}
                  onPress={() => setMode(value)}
                  style={[
                    styles.segment,
                    {
                      borderColor: active ? colors.accent : colors.border,
                      backgroundColor: active ? `${colors.accent}1A` : colors.background,
                      opacity: locked && !active ? 0.4 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.segmentLabel, { color: active ? colors.accent : colors.text }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.segments}>
            <Pressable
              testID="team-solo"
              accessibilityRole="button"
              accessibilityLabel="Run as the solo agent"
              accessibilityState={{ selected: team === null }}
              onPress={() => chooseTeam(null)}
              style={[
                styles.segment,
                {
                  borderColor: team === null ? colors.accent : colors.border,
                  backgroundColor: team === null ? `${colors.accent}1A` : colors.background,
                },
              ]}
            >
              <Ionicons name="person-outline" size={13} color={team === null ? colors.accent : colors.text} />
              <Text style={[styles.segmentLabel, { color: team === null ? colors.accent : colors.text }]}>Solo</Text>
            </Pressable>

            {teams.map(({ name, agents }) => {
              const active = team === name;
              return (
                <Pressable
                  key={name}
                  testID={`team-${name}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Run as the ${name} team, ${agents.length} worker${agents.length === 1 ? '' : 's'}`}
                  accessibilityState={{ selected: active }}
                  onPress={() => chooseTeam(name)}
                  style={[
                    styles.segment,
                    {
                      borderColor: active ? colors.accent : colors.border,
                      backgroundColor: active ? `${colors.accent}1A` : colors.background,
                    },
                  ]}
                >
                  <Ionicons name="people-outline" size={13} color={active ? colors.accent : colors.text} />
                  <Text style={[styles.segmentLabel, { color: active ? colors.accent : colors.text }]}>{name}</Text>
                  <Text style={[styles.segmentCount, { color: colors.textMuted }]}>{agents.length}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.segments}>
            {RUN_PROFILES.map((value) => {
              const active = profile === value;
              return (
                <Pressable
                  key={value}
                  testID={`profile-${value}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Profile ${value}`}
                  accessibilityState={{ selected: active, disabled: locked }}
                  disabled={locked}
                  onPress={() => setProfile(active ? null : value)}
                  style={[
                    styles.segment,
                    {
                      borderColor: active ? colors.accent : colors.border,
                      backgroundColor: active ? `${colors.accent}1A` : colors.background,
                      opacity: locked ? 0.5 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.segmentLabel, { color: active ? colors.accent : colors.text }]}>{value}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.hint, { color: colors.textMuted }]}>
            {locked
              ? 'Profile is fixed for the life of this session. Picking another team closes it and starts a new one.'
              : teams.length === 0
                ? `${MODES.find((entry) => entry.mode === mode)?.hint ?? ''} No teams on this server — the roster names none.`
                : (MODES.find((entry) => entry.mode === mode)?.hint ?? '')}
          </Text>

          {session ? (
            <View style={styles.headerActions}>
              <Pressable
                testID="close-session"
                accessibilityRole="button"
                accessibilityLabel="Close session"
                disabled={conversation.isClosing}
                onPress={() => conversation.close()}
              >
                <Text style={[styles.link, { color: colors.accent }]}>
                  {conversation.isClosing ? 'Closing…' : 'Close session'}
                </Text>
              </Pressable>
              {session.expires_at ? (
                <Text testID="session-expiry" style={[styles.hint, { color: colors.textMuted }]}>
                  reaped after {new Date(session.expires_at).toLocaleTimeString()}
                </Text>
              ) : null}
            </View>
          ) : null}

          {conversation.closeError ? (
            <Text testID="close-error" style={[styles.headerError, { color: colors.danger }]}>
              {describeApiError(conversation.closeError, 'That session did not close.')}
            </Text>
          ) : null}
        </View>

        <ScrollView
          ref={scrollRef}
          testID="chat-thread"
          contentContainerStyle={styles.thread}
          keyboardShouldPersistTaps="handled"
        >
          {entries.length === 0 ? (
            <Text testID="chat-empty" style={[styles.empty, { color: colors.textMuted }]}>
              Nothing here yet. Send a prompt and the finished run — output, tools, cost — lands in this thread.
            </Text>
          ) : (
            entries.map((entry) => <MessageBubble key={entry.id} entry={entry} />)
          )}

          {isSending ? (
            <View testID="chat-awaiting" style={styles.awaiting}>
              <ActivityIndicator size="small" color={colors.textMuted} />
              <Text style={[styles.awaitingText, { color: colors.textMuted }]}>
                Running. The reply arrives when the agent is done.
              </Text>
            </View>
          ) : null}
        </ScrollView>

        {conversation.sendError ? (
          <Text testID="chat-send-error" style={[styles.sendError, { color: colors.danger }]}>
            {describeApiError(conversation.sendError, 'That message did not send.')} Your text is still in the box.
          </Text>
        ) : null}

        {tooLong ? (
          <Text testID="prompt-too-long" style={[styles.sendError, { color: colors.danger }]}>
            {draft.length.toLocaleString()} characters — the server caps a prompt at{' '}
            {MAX_PROMPT_LENGTH.toLocaleString()}.
          </Text>
        ) : null}

        <MessageComposer
          value={draft}
          onChangeText={setDraft}
          onSend={submit}
          busy={isSending}
          disabled={tooLong}
          placeholder={mode === 'session' ? 'Send the next turn…' : 'Describe one piece of work…'}
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
  segments: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentLabel: { fontSize: 13, fontWeight: '600' },
  segmentCount: { fontSize: 11, fontFamily: 'monospace' },
  hint: { fontSize: 12, lineHeight: 17 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerError: { fontSize: 12 },
  link: { fontSize: 13, fontWeight: '600' },
  thread: { padding: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 },
  empty: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: spacing.xxl, paddingHorizontal: spacing.lg },
  awaiting: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  awaitingText: { fontSize: 13 },
  sendError: { fontSize: 12, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
});
