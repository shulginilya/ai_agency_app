import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { MAX_PROMPT_LENGTH, type RunProfile } from '@/api/schemas';
import { MessageBubble } from '@/components/MessageBubble';
import { MessageComposer } from '@/components/MessageComposer';
import { ProfileSheet } from '@/components/ProfileSheet';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { StatusPill } from '@/components/StatusPill';
import { TeamSheet } from '@/components/TeamSheet';
import { useConversation, type ConversationMode } from '@/hooks/useConversation';
import { useTeams } from '@/hooks/useTeams';
import { radius, spacing, useTheme } from '@/theme';

const MODE_HINT: Record<ConversationMode, string> = {
  session: 'Multi-turn. The agent remembers, and holds a subprocess open until you close it.',
  run: 'One prompt, one answer, no memory and nothing to clean up.',
};

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
 * ## The header, since 2026-09-03
 *
 * Three stacked rows of chips used to sit above the transcript: mode, team,
 * profile, one chip each, growing a row per team the server adds. They read as
 * one undifferentiated grid of toggles even though the three groups behave
 * differently, and on a phone they ate the thread.
 *
 * Now: one control bar. Mode is a segmented control, because it is the one
 * choice that is genuinely N-of-N-always-one. Team and profile are buttons
 * that open sheets, because both have a "none" state and both have more to say
 * than fits on a chip — the team button carries its worker count and how many
 * are running, and the sheet behind it lists the actual workers. Once a session
 * is open the bar collapses to a single summary line, since everything on it is
 * fixed anyway and the transcript wants the room.
 *
 * Profile and team are baked into the options a session connected with, and
 * sending either on a turn is a 422. Profile therefore locks once a session is
 * open. Team does not: picking another one closes the session then and there,
 * because "switch team" with no way to switch is not a feature. The sheet says
 * so before you press it, and `useConversation` closes it again as a backstop
 * if anything drives the hook past this screen.
 */
export function Conversation() {
  const { colors } = useTheme();
  const router = useRouter();
  const [mode, setMode] = useState<ConversationMode>('session');
  const [profile, setProfile] = useState<RunProfile | null>(null);
  const [team, setTeam] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [teamSheet, setTeamSheet] = useState(false);
  const [profileSheet, setProfileSheet] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const { teams, agents, isLoading: rosterLoading, error: rosterError } = useTeams();
  const conversation = useConversation({ mode, profile, team });
  const { entries, session, isSending } = conversation;
  const locked = session !== null;
  const tooLong = promptTooLong(draft);

  const always = useMemo(() => (agents ?? []).filter((agent) => !agent.team), [agents]);
  const members = useMemo(() => teams.find((entry) => entry.name === team)?.agents ?? [], [teams, team]);
  const running = members.filter((agent) => agent.status === 'running').length;

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

  const openAgent = useCallback(
    (id: string) => {
      setTeamSheet(false);
      router.push(`/agent/${encodeURIComponent(id)}`);
    },
    [router],
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

  const teamButton = (
    <Pressable
      testID="team-button"
      accessibilityRole="button"
      accessibilityLabel={
        team ? `Team ${team}, ${members.length} worker${members.length === 1 ? '' : 's'}. Change team` : 'Solo. Change team'
      }
      onPress={() => setTeamSheet(true)}
      style={[styles.control, { borderColor: team ? colors.accent : colors.border, backgroundColor: colors.background }]}
    >
      <Ionicons
        name={team ? 'people-outline' : 'person-outline'}
        size={14}
        color={team ? colors.accent : colors.textMuted}
      />
      <Text style={[styles.controlLabel, { color: team ? colors.accent : colors.text }]}>{team ?? 'Solo'}</Text>
      <Text testID="team-button-meta" style={[styles.controlMeta, { color: colors.textMuted }]}>
        {team ? `${members.length}w` : `${always.length} always`}
      </Text>
      {running > 0 ? (
        <View testID="team-button-running" style={[styles.runningDot, { backgroundColor: colors.success }]} />
      ) : null}
      <Ionicons name="chevron-down" size={13} color={colors.textMuted} />
    </Pressable>
  );

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

          {session ? (
            /* Everything on the bar is fixed for the life of this session, so
               it collapses to a line that states it, plus the two things still
               worth a press: leaving, and switching team (which ends it). */
            <View testID="session-bar" style={styles.controls}>
              <Text testID="session-summary" style={[styles.summary, { color: colors.textMuted }]}>
                Session · {profile ?? 'server default'}
              </Text>
              {teamButton}
              <Pressable
                testID="close-session"
                accessibilityRole="button"
                accessibilityLabel="Close session"
                disabled={conversation.isClosing}
                onPress={() => conversation.close()}
                style={[styles.control, { borderColor: colors.border, backgroundColor: colors.background }]}
              >
                <Ionicons name="stop-circle-outline" size={14} color={colors.danger} />
                <Text style={[styles.controlLabel, { color: colors.danger }]}>
                  {conversation.isClosing ? 'Closing…' : 'Close'}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View testID="control-bar" style={styles.controls}>
              <SegmentedControl
                testIDPrefix="mode"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'session', label: 'Session', accessibilityLabel: 'Session mode' },
                  { value: 'run', label: 'One-shot', accessibilityLabel: 'One-shot mode' },
                ]}
              />
              {teamButton}
              <Pressable
                testID="profile-button"
                accessibilityRole="button"
                accessibilityLabel={profile ? `Profile ${profile}. Change profile` : 'Server default profile. Change profile'}
                onPress={() => setProfileSheet(true)}
                style={[
                  styles.control,
                  { borderColor: profile ? colors.accent : colors.border, backgroundColor: colors.background },
                ]}
              >
                <Ionicons name="options-outline" size={14} color={profile ? colors.accent : colors.textMuted} />
                <Text style={[styles.controlLabel, { color: profile ? colors.accent : colors.text }]}>
                  {profile ?? 'default'}
                </Text>
                <Ionicons name="chevron-down" size={13} color={colors.textMuted} />
              </Pressable>
            </View>
          )}

          <View style={styles.hintRow}>
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              {locked
                ? 'Profile is fixed for the life of this session. Picking another team closes it and starts a new one.'
                : MODE_HINT[mode]}
            </Text>
            {session?.expires_at ? (
              <Text testID="session-expiry" style={[styles.hint, { color: colors.textMuted }]}>
                Reaped after {new Date(session.expires_at).toLocaleTimeString()}.
              </Text>
            ) : null}
          </View>

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

      <TeamSheet
        visible={teamSheet}
        onClose={() => setTeamSheet(false)}
        teams={teams}
        always={always}
        selected={team}
        onSelect={chooseTeam}
        onOpenAgent={(agent) => openAgent(agent.id)}
        sessionOpen={locked}
        isLoading={rosterLoading}
        error={rosterError}
      />

      <ProfileSheet
        visible={profileSheet}
        onClose={() => setProfileSheet(false)}
        selected={profile}
        onSelect={setProfile}
        locked={locked}
      />
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
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 3,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  controlLabel: { fontSize: 13, fontWeight: '600' },
  controlMeta: { fontSize: 11, fontFamily: 'monospace' },
  runningDot: { width: 6, height: 6, borderRadius: radius.pill },
  summary: { fontSize: 12, fontFamily: 'monospace' },
  hintRow: { gap: 2 },
  hint: { fontSize: 12, lineHeight: 17 },
  headerError: { fontSize: 12 },
  thread: { padding: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 },
  empty: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: spacing.xxl, paddingHorizontal: spacing.lg },
  awaiting: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  awaitingText: { fontSize: 13 },
  sendError: { fontSize: 12, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
});
