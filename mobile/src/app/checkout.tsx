import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useAuth } from "@/lib/auth";
import {
  DELIVERY_LABELS,
  addAddress,
  addressLine,
  buyNow,
  checkoutTotal,
  eur,
  finishOfferCheckout,
  listAddresses,
  loadBuyNowItem,
  loadOfferOrderItem,
  sweepMarketplace,
  type Address,
  type CheckoutItem,
  type DeliveryMethod,
  type NewAddress,
} from "@/lib/purchase";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Checkout, in the app.
 *
 * Two ways in, one screen — the same as the website's shared CheckoutForm:
 *   ?listing=ID  Buy now. Submitting creates the order and reserves the item
 *                (create_purchase_order(), 0050).
 *   ?order=ID    An accepted offer. The order already exists; submitting
 *                records how it is getting to the buyer
 *                (finalize_offer_checkout(), 0050).
 *
 * Either way the member picks collection or post, an address if posting,
 * sees the total, and agrees to the terms. Then they land on the order,
 * which opens Stripe's card page to pay — the one step still on the website.
 *
 * The total here is computed the same way the database computes it, and is
 * a display hint only: the order snapshots the real figures.
 */
export default function CheckoutScreen() {
  const params = useLocalSearchParams<{ listing?: string; order?: string }>();
  const listingId = params.listing ? Number(params.listing) : null;
  const orderId = params.order ? Number(params.order) : null;
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [item, setItem] = useState<CheckoutItem | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [method, setMethod] = useState<DeliveryMethod>("collection");
  const [addressId, setAddressId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    try {
      // Release lapsed reservations first, or an item whose last buyer
      // walked away would still read as unavailable here.
      await sweepMarketplace();
      const [loaded, saved] = await Promise.all([
        orderId ? loadOfferOrderItem(orderId) : listingId ? loadBuyNowItem(listingId) : Promise.resolve(null),
        listAddresses(userId),
      ]);
      setItem(loaded);
      setAddresses(saved);
      if (loaded) setMethod(loaded.deliveryOptions[0]);
      setAddressId(saved[0]?.id ?? null);
      setAdding(saved.length === 0);
    } finally {
      setLoading(false);
    }
  }, [userId, orderId, listingId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <Stack.Screen options={{ title: "Checkout", headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  if (!item) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <Stack.Screen options={{ title: "Checkout", headerBackTitle: "Back" }} />
        <Ionicons name="bag-outline" size={42} color={colors.ink500} />
        <Text style={styles.emptyTitle}>This can't be bought right now</Text>
        <Text style={styles.emptyBody}>
          It may have sold, been reserved by someone else, or the checkout window may have closed.
        </Text>
      </View>
    );
  }

  const needsAddress = method === "post";
  const totals = checkoutTotal(item.priceEur, method);
  const canSubmit = agreed && !busy && (!needsAddress || addressId !== null);

  async function submit() {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const address = needsAddress ? addressId : null;
      const result = item.orderId
        ? await finishOfferCheckout(item.orderId, method, address)
        : await buyNow(item.listingId, method, address);
      // Replace, not push: Back from the order should not land on a
      // checkout for something that is now reserved.
      router.replace({ pathname: "/order/[id]", params: { id: String(result.order_id), pay: "1" } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't complete that — please try again.");
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: "Checkout", headerBackTitle: "Back" }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* What is being bought */}
        <View style={[styles.card, styles.itemRow]}>
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, styles.thumbNone]}>
              <Ionicons name="image-outline" size={22} color={colors.ink500} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.itemTitle} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={styles.muted}>Sold by {item.sellerName}</Text>
            <Text style={styles.itemPrice}>{eur(item.priceEur)}</Text>
          </View>
        </View>

        {/* Delivery */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Delivery</Text>
          {item.deliveryOptions.map((option) => (
            <Radio
              key={option}
              selected={method === option}
              label={DELIVERY_LABELS[option]}
              onPress={() => setMethod(option)}
            />
          ))}
          {method === "collection" && item.collectionNotes ? (
            <Text style={styles.note}>{item.collectionNotes}</Text>
          ) : null}
        </View>

        {/* Address, when posting */}
        {needsAddress ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Delivery address</Text>
            {addresses.map((a) => (
              <Radio
                key={a.id}
                selected={addressId === a.id}
                label={a.label}
                detail={addressLine(a)}
                onPress={() => setAddressId(a.id)}
              />
            ))}
            {adding ? (
              <AddressForm
                onCancel={addresses.length > 0 ? () => setAdding(false) : undefined}
                onSave={async (fields) => {
                  if (!userId) return;
                  const saved = await addAddress(userId, fields);
                  setAddresses((prev) => [saved, ...prev]);
                  setAddressId(saved.id);
                  setAdding(false);
                }}
              />
            ) : (
              <Pressable onPress={() => setAdding(true)} accessibilityRole="button" style={styles.linkRow}>
                <Ionicons name="add" size={18} color={colors.green700} />
                <Text style={styles.link}>Add a new address</Text>
              </Pressable>
            )}
          </View>
        ) : null}

        {/* Total */}
        <View style={styles.card}>
          <Line label="Item" value={eur(totals.price)} />
          <Line label="PinPals fee (7%)" value={eur(totals.fee)} />
          {totals.delivery > 0 ? <Line label="Postage" value={eur(totals.delivery)} /> : null}
          <View style={styles.rule} />
          <Line label="Total" value={eur(totals.total)} strong />
        </View>

        <Pressable
          style={styles.agree}
          onPress={() => setAgreed(!agreed)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
        >
          <Ionicons
            name={agreed ? "checkbox" : "square-outline"}
            size={22}
            color={agreed ? colors.green700 : colors.ink500}
          />
          <Text style={styles.agreeText}>
            I agree to the PinPals Terms and Marketplace Rules. This item is sold by another member, not by
            PinPals.
          </Text>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.primary, !canSubmit && styles.primaryOff]}
          disabled={!canSubmit}
          onPress={() => void submit()}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.cream50} />
          ) : (
            <Text style={styles.primaryLabel}>Reserve and pay {eur(totals.total)}</Text>
          )}
        </Pressable>
        <Text style={styles.footnote}>
          The item is held for you for 30 minutes while you pay. Card payment is taken securely by Stripe.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Radio({
  selected,
  label,
  detail,
  onPress,
}: {
  selected: boolean;
  label: string;
  detail?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.radio, selected && styles.radioOn]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={20}
        color={selected ? colors.green700 : colors.ink500}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.radioLabel}>{label}</Text>
        {detail ? <Text style={styles.muted}>{detail}</Text> : null}
      </View>
    </Pressable>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={strong ? styles.lineStrong : styles.lineLabel}>{label}</Text>
      <Text style={strong ? styles.lineStrong : styles.lineValue}>{value}</Text>
    </View>
  );
}

const EMPTY: NewAddress = { label: "Home", recipientName: "", line1: "", line2: "", city: "", county: "", eircode: "" };

function AddressForm({
  onSave,
  onCancel,
}: {
  onSave: (fields: NewAddress) => Promise<void>;
  onCancel?: () => void;
}) {
  const [fields, setFields] = useState<NewAddress>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof NewAddress) => (value: string) => setFields((prev) => ({ ...prev, [key]: value }));

  return (
    <View style={styles.form}>
      <Field label="Label" value={fields.label} onChange={set("label")} placeholder="Home" />
      <Field label="Recipient name" value={fields.recipientName} onChange={set("recipientName")} autoComplete="name" />
      <Field label="Address line 1" value={fields.line1} onChange={set("line1")} autoComplete="address-line1" />
      <Field label="Address line 2 (optional)" value={fields.line2} onChange={set("line2")} autoComplete="address-line2" />
      <Field label="Town / city" value={fields.city} onChange={set("city")} />
      <Field label="County (optional)" value={fields.county} onChange={set("county")} />
      <Field label="Eircode (optional)" value={fields.eircode} onChange={set("eircode")} autoComplete="postal-code" />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.formButtons}>
        {onCancel ? (
          <Pressable style={styles.secondary} onPress={onCancel} accessibilityRole="button">
            <Text style={styles.secondaryLabel}>Cancel</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.primary, { flex: 1 }]}
          disabled={busy}
          accessibilityRole="button"
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              await onSave(fields);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Couldn't save that address.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.primaryLabel}>Save address</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: "name" | "address-line1" | "address-line2" | "postal-code";
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.ink500}
        autoComplete={autoComplete}
        autoCapitalize={autoComplete === "postal-code" ? "characters" : "words"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center", padding: spacing.lg, gap: spacing.sm },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 21, color: colors.ink900, textAlign: "center" },
  emptyBody: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink500, textAlign: "center" },

  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  thumb: { width: 64, height: 64, borderRadius: radii.md, backgroundColor: colors.cream100 },
  thumbNone: { alignItems: "center", justifyContent: "center" },
  itemTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  itemPrice: { fontFamily: fonts.display, fontSize: 20, color: colors.green700, marginTop: 2 },
  muted: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  note: {
    fontFamily: fonts.body,
    fontSize: type.small,
    color: colors.ink500,
    backgroundColor: colors.cream100,
    borderRadius: radii.sm,
    padding: spacing.sm,
  },

  radio: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  radioOn: { borderColor: colors.green700, backgroundColor: colors.green100 },
  radioLabel: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 },
  link: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },

  form: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line },
  formButtons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  fieldLabel: { fontFamily: fonts.bodySemi, fontSize: type.label, color: colors.ink900 },
  input: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
    backgroundColor: colors.surface,
  },

  line: { flexDirection: "row", justifyContent: "space-between" },
  lineLabel: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink500 },
  lineValue: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  lineStrong: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink900 },
  rule: { height: 1, backgroundColor: colors.line, marginVertical: 2 },

  agree: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  agreeText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink900 },
  error: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600 },

  primary: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
    paddingHorizontal: spacing.md,
  },
  primaryOff: { opacity: 0.5 },
  primaryLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  secondary: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.line,
    paddingHorizontal: spacing.lg,
  },
  secondaryLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink500 },
  footnote: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, textAlign: "center" },
});
