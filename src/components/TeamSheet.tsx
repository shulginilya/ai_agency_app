import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { describeApiError } from '@/api/errors';
import type { AgentInfo } from '@/api/schemas';
import type { TeamSummary } from '@/api/teams';
import { BottomSheet } from '@/components/BottomSheet';
import { STATUS_TONE } from '@/screens/AgentDetail';
import { radius, spacing, useTheme, type Colors } from '@/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  teams: TeamSummary[];
  /** The `always` agents: loaded whichever team runs, so listed once, apart. */
  always: AgentInfo[];
  selected: string | null;
  onSelect: (team: string | null) => void;
  onOpenAgent: (agent: AgentInfo) => void;
  /** True when a session is open — picking a team will close it, and says so. */
  sessionOpen: boolean;
  isLoading: boolean;
  error: unknown;
};

function toneColor(colors: Colors, agent: AgentInfo): string {
  const tone = STATUS_TONE[agent.status] ?? 'muted';
  if (tone === 'success') return colors.success;
  if (tone === 'danger') return colors.danger;
  if (tone === 'warning') return colors.warning;
  return colors.textMuted;
}

/**
 * The team picker, with the roster inside it.
 *
 * A chip with a number on it answered "how many workers" and nothing else —
 * not who they are, not whether any of them is alive right now, not what the
 * manager would route to them. All of that is already in the roster the app
 * polls, so this sheet spends the room to show it: every team, its workers,
 * each worker's live status and what it is for.
 *
 * Two kinds of press per team, deliberately separated: the header row picks
 * the team, a worker row opens that worker's detail. Nesting the second inside
 * the first would make the whole card ambiguous.
 */
export function TeamSheet({
  visible,
  onClose,
  teams,
  always,
  selected,
  onSelect,
  onOpenAgent,
  sessionOpen,
  isLoading,
  error,
}: Props) {
  const { colors } = useTheme();

  const choose = (team: string | null) => {
    onSelect(team);
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      testID="team-sheet"
      title="Run as"
      subtitle="Sent as team when the run opens. That team's manager may delegate to its workers, plus everything loaded on every run."
    >
      {sessionOpen ? (
        <Text testID="team-sheet-warning" style={[styles.warning, { color: colors.warning }]}>
          A session is open. Its team was fixed when it connected — picking another one closes it.
        </Text>
      ) : null}

      <Pressable
        testID="team-solo"
        accessibilityRole="button"
        accessibilityLabel="Run as the solo agent"
        accessibilityState={{ selected: selected === null }}
        onPress={() => choose(null)}
        style={[
          styles.card,
          {
            backgroundColor: colors.background,
            borderColor: selected === null ? colors.accent : colors.border,
          },
        ]}
      >
        <View style={styles.cardHead}>
          <Ionicons name="person-outline" size={16} color={selected === null ? colors.accent : colors.text} />
          <Text style={[styles.cardTitle, { color: selected === null ? colors.accent : colors.text }]}>Solo</Text>
          <View style={styles.flex} />
          {selected === null ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
        </View>
        <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
          No team. Only the {always.length} agent{always.length === 1 ? '' : 's'} loaded on every run are reachable.
        </Text>
      </Pressable>

      {isLoading && teams.length === 0 ? (
        <ActivityIndicator testID="team-sheet-loading" color={colors.accent} />
      ) : error && teams.length === 0 ? (
        <Text testID="team-sheet-error" style={[styles.cardMeta, { color: colors.textMuted }]}>
          {describeApiError(error, 'Could not load the roster, so there are no teams to offer.')}
        </Text>
      ) : teams.length === 0 ? (
        <Text testID="team-sheet-empty" style={[styles.cardMeta, { color: colors.textMuted }]}>
          No teams on this server — no agent in the roster names one.
        </Text>
      ) : (
        teams.map(({ name, agents }) => {
          const active = selected === name;
          const running = agents.filter((agent) => agent.status === 'running').length;
          return (
            <View
              key={name}
              style={[styles.card, { backgroundColor: colors.background, borderColor: active ? colors.accent : colors.border }]}
            >
              <Pressable
                testID={`team-${name}`}
                accessibilityRole="button"
                accessibilityLabel={`Run as the ${name} team, ${agents.length} worker${agents.length === 1 ? '' : 's'}`}
                accessibilityState={{ selected: active }}
                onPress={() => choose(name)}
              >
                <View style={styles.cardHead}>
                  <Ionicons name="people-outline" size={16} color={active ? colors.accent : colors.text} />
                  <Text style={[styles.cardTitle, { color: active ? colors.accent : colors.text }]}>{name}</Text>
                  <View style={styles.flex} />
                  {active ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
                </View>
                <Text testID={`team-meta-${name}`} style={[styles.cardMeta, { color: colors.textMuted }]}>
                  {agents.length} worker{agents.length === 1 ? '' : 's'}
                  {running > 0 ? ` · ${running} running now` : ''}
                </Text>
              </Pressable>

              <View style={[styles.members, { borderTopColor: colors.border }]}>
                {agents.map((agent) => (
                  <MemberRow key={agent.id} agent={agent} onPress={() => onOpenAgent(agent)} />
                ))}
              </View>
            </View>
          );
        })
      )}

      {always.length > 0 ? (
        <View testID="team-sheet-always" style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={styles.cardHead}>
            <Ionicons name="infinite-outline" size={16} color={colors.textMuted} />
            <Text style={[styles.cardTitle, { color: colors.textMuted }]}>Loaded on every run</Text>
          </View>
          <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
            Not a team, and not a choice — these come along whatever you pick.
          </Text>
          <View style={[styles.members, { borderTopColor: colors.border }]}>
            {always.map((agent) => (
              <MemberRow key={agent.id} agent={agent} onPress={() => onOpenAgent(agent)} />
            ))}
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
}

function MemberRow({ agent, onPress }: { agent: AgentInfo; onPress: () => void }) {
  const { colors } = useTheme();
  const color = toneColor(colors, agent);

  return (
    <Pressable
      testID={`team-member-${agent.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Open ${agent.name}, status ${agent.status}`}
      onPress={onPress}
      style={styles.member}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={styles.flex}>
        <View style={styles.memberHead}>
          <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
            {agent.name}
          </Text>
          <Text style={[styles.memberStatus, { color }]}>{agent.status}</Text>
        </View>
        <Text style={[styles.memberDescription, { color: colors.textMuted }]} numberOfLines={2}>
          {agent.description}
        </Text>
        <Text testID={`team-member-meta-${agent.id}`} style={[styles.memberMeta, { color: colors.textMuted }]}>
          {[
            agent.model ?? 'inherited model',
            agent.tools ? `${agent.tools.length} tools` : 'inherited tools',
            `${agent.invocations ?? 0} invocations`,
          ].join(' · ')}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  warning: { fontSize: 12, lineHeight: 17 },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  cardMeta: { fontSize: 12, lineHeight: 17 },
  members: { marginTop: spacing.sm, paddingTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth },
  member: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: radius.pill, marginTop: 5 },
  memberHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  memberName: { fontSize: 13, fontWeight: '600' },
  memberStatus: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  memberDescription: { fontSize: 12, lineHeight: 16, marginTop: 1 },
  memberMeta: { fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
});
