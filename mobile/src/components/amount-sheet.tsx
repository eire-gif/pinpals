import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { parseEuro } from "@/lib/purchase";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A sheet that asks for one amount in euro — an offer, a counter-offer or a
 * bid — and sends it.
 *
 * The figure is checked here only for shape (a positive number, at most two
 * decimals). Whether it is enough is the database's call: the offer, counter
 * and bid functions each refuse with a message written for the member, and
 * that message is what lands in the sheet. A stale "minimum" on screen can
 * only ever produce a polite refusal, never an accepted under-bid.
 */
export function AmountSheet({
  visible,
  title,
  intro,
  initial = "",
  placeholder,
  summary,
  confirmLabel,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  intro?: string;
  initial?: string;
  placeholder?: string;
  /** A line under the box, recomputed as the member types. */
  summary?: (amount: number | null) => string | null;
  confirmLabel: (amount: number | null) => string;
  /** Resolve to close; throw to show the error and stay open. */
  onSubmit: (amount: number) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset only as the sheet OPENS. Resetting whenever `initial` changed
  // would wipe a bid mid-typing when the listing reloads underneath with a
  // new minimum.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setText(initial);
      setError(null);
      setBusy(false);
    }
    wasVisible.current = visible;
  }, [visible, initial]);

  const amount = parseEuro(text);
  const line = summary?.(amount) ?? null;

  async function submit() {
    if (amount === null) {
      setError("Enter an amount in euro, like 120 or 85.50.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(amount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.dismiss} onPress={busy ? undefined : onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{title}</Text>
          {intro ? <Text style={styles.intro}>{intro}</Text> : null}

          <View style={styles.inputRow}>
            <Text style={styles.currency}>€</Text>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={(value) => {
                setText(value);
                setError(null);
              }}
              placeholder={placeholder}
              placeholderTextColor={colors.ink500}
              keyboardType="decimal-pad"
              autoFocus
              editable={!busy}
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
              accessibilityLabel={`${title}, amount in euro`}
            />
          </View>

          {line ? <Text style={styles.summary}>{line}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.confirm, (busy || amount === null) && styles.confirmOff]}
            disabled={busy}
            onPress={() => void submit()}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={colors.cream50} />
            ) : (
              <Text style={styles.confirmLabel}>{confirmLabel(amount)}</Text>
            )}
          </Pressable>
          <Pressable style={styles.cancel} onPress={onClose} disabled={busy} accessibilityRole="button">
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(12,32,56,0.45)" },
  dismiss: { flex: 1 },
  sheet: {
    backgroundColor: colors.cream50,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    marginBottom: spacing.sm,
  },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.ink900 },
  intro: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink500 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  currency: { fontFamily: fonts.bodyBold, fontSize: 22, color: colors.ink500 },
  input: { flex: 1, paddingVertical: 12, fontFamily: fonts.bodyBold, fontSize: 22, color: colors.ink900 },
  summary: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  error: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600 },
  confirm: {
    marginTop: spacing.sm,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
  },
  confirmOff: { opacity: 0.55 },
  confirmLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  cancel: { alignItems: "center", paddingVertical: spacing.sm },
  cancelLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500 },
});
