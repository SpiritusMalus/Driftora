import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// A deliberately tiny markdown renderer for the bundled legal docs — just the
/// subset they use (h1/h2 headings, `**bold**` inline spans, `- ` bullets, and
/// blank-line-separated paragraphs). Kept in-repo so we add no markdown
/// dependency (TASK §E: prefer bundled markdown + existing components). Not a
/// general-purpose parser — it only has to render `lib/legal/documents.ts`.

/// Split a line into plain + bold runs on `**…**`. Odd boundaries are treated
/// as plain text (a stray `**` just renders literally), so it never throws.
function renderInline(line: string, color: string) {
  const parts = line.split('**');
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <Text key={i} style={{ fontWeight: '700', color }}>
        {part}
      </Text>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export function Markdown({ source }: { source: string }) {
  const theme = useTheme();
  const lines = source.replace(/\r\n/g, '\n').split('\n');

  return (
    <View>
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (line.length === 0) return <View key={i} style={styles.gap} />;

        if (line.startsWith('## ')) {
          return (
            <Text key={i} style={[styles.h2, { color: theme.text }, theme.font.heading]}>
              {line.slice(3)}
            </Text>
          );
        }
        if (line.startsWith('# ')) {
          return (
            <Text key={i} style={[styles.h1, { color: theme.text }, theme.font.display]}>
              {line.slice(2)}
            </Text>
          );
        }
        if (line.startsWith('- ')) {
          return (
            <View key={i} style={styles.bulletRow}>
              <Text style={[styles.bullet, { color: theme.subtle }]}>•</Text>
              <Text style={[styles.body, { color: theme.text }, theme.font.body]}>
                {renderInline(line.slice(2), theme.text)}
              </Text>
            </View>
          );
        }
        return (
          <Text key={i} style={[styles.body, { color: theme.text }, theme.font.body]}>
            {renderInline(line, theme.text)}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { height: 10 },
  h1: { fontSize: 20, marginBottom: 6, lineHeight: 26 },
  h2: { fontSize: 16, marginTop: 14, marginBottom: 4, lineHeight: 22 },
  body: { fontSize: 14, lineHeight: 21, flex: 1 },
  bulletRow: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  bullet: { fontSize: 14, lineHeight: 21 },
});
