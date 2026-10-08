import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Chip, ChipGroup, Collapsible, Section } from "@/components/form-bits";
import { PhotoStrip, type Photo } from "@/components/photo-strip";
import { ApiError, type UploadFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  BRAND_OTHER,
  CATEGORIES,
  CONDITIONS,
  DELIVERY_OPTIONS,
  MAX_BRAND_OTHER_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_LISTING_IMAGES,
  MAX_TITLE_LENGTH,
  SALE_TYPES,
  SUBCATEGORIES,
  brandsFor,
  createListing,
  parsePrice,
  sellerPlace,
  uploadPhoto,
  type Brand,
  type Category,
  type SaleType,
} from "@/lib/listings";
import { COUNTRY_NAMES, regionsFor } from "@/lib/tee-time-post";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { FORM_SCROLL_KEYBOARD, KeyboardDoneButton } from "@/components/keyboard";
import { PHOTO_PICKER_OPTIONS, preparePhotoForUpload } from "@/lib/photo-picking";

/**
 * Listing something for sale.
 *
 * The website's form has around twenty fields — brand, model, dexterity,
 * shaft flex, shaft material, loft, size, four sale types, auction dates.
 * That form is right at a desk and wrong on a phone. This one asks for the
 * nine things a listing genuinely cannot do without, and everything else
 * stays on the listing's own edit page, where a seller who cares about shaft
 * flex can add it afterwards.
 *
 * Photos go up as they are picked, not at the end, so a failure is one
 * thumbnail to retry rather than a form to fill in twice.
 *
 * It saves a DRAFT and then opens the listing's page. Publishing re-checks
 * that the seller can take money — that check lives on the server and the
 * app does not get to skip it.
 */

const COUNTRY_CODES = [
  "ireland",
  "northern-ireland",
  "england",
  "scotland",
  "wales",
  "spain",
  "portugal",
] as const;

type OpenSection = "category" | "subcategory" | "brand" | "county" | null;

export default function NewListingScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [photos, setPhotos] = useState<Photo[]>([]);
  // Kept out of state deliberately: a retry needs the original file, and the
  // file is not something any render depends on.
  const files = useRef(new Map<string, UploadFile>());

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category | null>(null);
  const [subcategory, setSubcategory] = useState<string | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const [brandOther, setBrandOther] = useState("");
  const [brands, setBrands] = useState<Brand[]>([]);
  const [condition, setCondition] = useState<string | null>(null);
  const [saleType, setSaleType] = useState<SaleType>("fixed_price");
  const [price, setPrice] = useState("");
  const [delivery, setDelivery] = useState<string[]>(["post"]);
  const [country, setCountry] = useState<string>("ireland");
  const [county, setCounty] = useState<string | null>(null);
  const [counties, setCounties] = useState<string[]>([]);
  const [description, setDescription] = useState("");

  const [open, setOpen] = useState<OpenSection>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (section: Exclude<OpenSection, null>) =>
    setOpen((current) => (current === section ? null : section));

  // ---- the seller's own county, as the starting point -------------------
  useEffect(() => {
    if (!userId) return;
    void sellerPlace(userId).then((place) => {
      if (place.country) setCountry(place.country);
      if (place.county) setCounty(place.county);
    });
  }, [userId]);

  useEffect(() => {
    void regionsFor(country).then(setCounties);
  }, [country]);

  // ---- brands follow the category ---------------------------------------
  useEffect(() => {
    if (!category) {
      setBrands([]);
      return;
    }
    void brandsFor(category, subcategory).then(setBrands);
  }, [category, subcategory]);

  // A brand that made sense under the old category usually doesn't under the
  // new one — Motocaddy is a trolley brand, not a wedge brand. The website
  // clears it for the same reason; silently keeping it would submit a brand
  // the seller is no longer being shown.
  useEffect(() => {
    if (!brand || brand === BRAND_OTHER) return;
    if (brands.length > 0 && !brands.some((b) => b.id === brand)) setBrand(null);
  }, [brands, brand]);

  // ---- photos ------------------------------------------------------------

  const send = useCallback(async (id: string, file: UploadFile) => {
    files.current.set(id, file);
    setPhotos((prev) =>
      prev.map((photo) =>
        photo.id === id ? { ...photo, status: "uploading", error: undefined } : photo
      )
    );

    try {
      const uploaded = await uploadPhoto(file);
      setPhotos((prev) =>
        prev.map((photo) =>
          photo.id === id ? { ...photo, status: "done", uploaded } : photo
        )
      );
    } catch (err) {
      setPhotos((prev) =>
        prev.map((photo) =>
          photo.id === id
            ? {
                ...photo,
                status: "failed",
                error:
                  err instanceof ApiError
                    ? err.message
                    : "Couldn't upload that photo.",
              }
            : photo
        )
      );
    }
  }, []);

  const add = useCallback(
    (assets: ImagePicker.ImagePickerAsset[]) => {
      for (const asset of assets) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const file: UploadFile = {
          uri: asset.uri,
          // A camera capture often has no filename of its own.
          name: asset.fileName ?? `photo-${id}.jpg`,
          type: asset.mimeType ?? "image/jpeg",
        };
        setPhotos((prev) => [...prev, { id, uri: asset.uri, status: "uploading" }]);
        // Resized on the phone first where the build can (photo-picking.ts).
        void preparePhotoForUpload({ ...file, width: asset.width, height: asset.height }).then((ready) => send(id, ready));
      }
    },
    [send]
  );

  const capture = useCallback(
    async (source: "camera" | "library") => {
      const permission =
        source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          source === "camera" ? "Camera is off" : "Photos are off",
          "PinPals needs this to add photos to your listing. You can turn it on in Settings.",
          [
            { text: "Not now", style: "cancel" },
            { text: "Open Settings", onPress: () => void Linking.openSettings() },
          ]
        );
        return;
      }

      const remaining = MAX_LISTING_IMAGES - photos.length;
      const result =
        source === "camera"
          ? // Smaller JPEGs: see lib/photo-picking.ts.
            await ImagePicker.launchCameraAsync(PHOTO_PICKER_OPTIONS)
          : await ImagePicker.launchImageLibraryAsync({
              ...PHOTO_PICKER_OPTIONS,
              allowsMultipleSelection: true,
              selectionLimit: remaining,
            });

      if (result.canceled) return;
      add(result.assets.slice(0, remaining));
    },
    [add, photos.length]
  );

  const pick = () =>
    Alert.alert("Add a photo", undefined, [
      { text: "Take a photo", onPress: () => void capture("camera") },
      { text: "Choose from library", onPress: () => void capture("library") },
      { text: "Cancel", style: "cancel" },
    ]);

  const remove = (id: string) => {
    files.current.delete(id);
    setPhotos((prev) => prev.filter((photo) => photo.id !== id));
  };

  const retry = (id: string) => {
    const file = files.current.get(id);
    if (file) void send(id, file);
  };

  // ---- posting -----------------------------------------------------------

  const uploading = photos.some((photo) => photo.status === "uploading");
  const ready = photos.filter((photo) => photo.status === "done" && photo.uploaded);
  const priceValue = parsePrice(price);

  // The server accepts a listing with no photos, because the website's form
  // does. The app requires one, and that difference is deliberate: the whole
  // reason to list from a phone is that the club is in front of you. A
  // photoless listing posted from here is nearly always a mistake.
  const complete =
    ready.length > 0 &&
    title.trim().length >= 3 &&
    category !== null &&
    condition !== null &&
    county !== null &&
    delivery.length > 0 &&
    priceValue !== null &&
    (brand !== BRAND_OTHER || brandOther.trim().length > 0);

  const post = async () => {
    if (!complete || posting || uploading || !category || !condition || !county) return;

    setPosting(true);
    setError(null);

    try {
      const created = await createListing({
        title: title.trim(),
        description: description.trim(),
        category,
        subcategory: subcategory ?? "",
        condition,
        county,
        brand,
        brandOther: brand === BRAND_OTHER ? brandOther.trim() : null,
        saleType,
        priceEur: priceValue!,
        deliveryOptions: delivery,
        images: ready.map((photo) => photo.uploaded!),
      });

      // Draft, not live. Sending them to the listing's own page is what puts
      // Publish — and its payment-readiness check — in front of them.
      router.replace({
        pathname: "/web",
        params: {
          path: `/marketplace/${created.listingId}?draft=1`,
          title: "Your listing",
        },
      });

      if (!created.imagesAttached) {
        Alert.alert(
          "Listing saved, photos didn't",
          "The listing is there as a draft but the photos didn't attach. You can add them on this page before publishing."
        );
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't post that listing."
      );
      setPosting(false);
    }
  };

  const subcategories = category ? SUBCATEGORIES[category] : [];
  const brandLabel =
    brand === BRAND_OTHER
      ? brandOther.trim() || "Other"
      : (brands.find((b) => b.id === brand)?.label ?? null);

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "List an item", headerBackTitle: "Back" }} />

      <ScrollView
        contentContainerStyle={styles.content}
        // Scrolls the field being typed in (the description, say) above the
        // keyboard; drag down to put the keyboard away.
        {...FORM_SCROLL_KEYBOARD}
      >
        <PhotoStrip
          photos={photos}
          max={MAX_LISTING_IMAGES}
          onAdd={pick}
          onRemove={remove}
          onRetry={retry}
        />

        <Section title="What is it?">
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="TaylorMade Stealth 2 driver, 10.5°"
            placeholderTextColor={colors.ink500}
            maxLength={MAX_TITLE_LENGTH}
            accessibilityLabel="Title"
          />
        </Section>

        <Collapsible
          label="Category"
          value={category}
          placeholder="Choose one"
          open={open === "category"}
          onToggle={() => toggle("category")}
        >
          <ChipGroup>
            {CATEGORIES.map((item) => (
              <Chip
                key={item}
                label={item}
                selected={category === item}
                onPress={() => {
                  setCategory(item);
                  setSubcategory(null);
                  setBrand(null);
                  setOpen(null);
                }}
              />
            ))}
          </ChipGroup>
        </Collapsible>

        <Collapsible
          label="Type"
          value={subcategory}
          placeholder={category ? "Optional" : "Pick a category first"}
          disabled={!category}
          open={open === "subcategory"}
          onToggle={() => toggle("subcategory")}
        >
          <ChipGroup>
            {subcategories.map((item) => (
              <Chip
                key={item}
                label={item}
                selected={subcategory === item}
                onPress={() => {
                  setSubcategory(subcategory === item ? null : item);
                  setOpen(null);
                }}
              />
            ))}
          </ChipGroup>
        </Collapsible>

        <Collapsible
          label="Brand"
          value={brandLabel}
          placeholder={category ? "Optional" : "Pick a category first"}
          disabled={!category}
          open={open === "brand"}
          onToggle={() => toggle("brand")}
        >
          {/* Said plainly because it is true and sellers skip it: brand is
              the filter buyers actually use. */}
          <Text style={styles.hint}>
            Buyers filter by brand — it's the single biggest thing that helps
            your item get found.
          </Text>
          <ChipGroup>
            {brands.map((item) => (
              <Chip
                key={item.id}
                label={item.label}
                selected={brand === item.id}
                onPress={() => {
                  setBrand(brand === item.id ? null : item.id);
                  if (item.id !== BRAND_OTHER) setOpen(null);
                }}
              />
            ))}
          </ChipGroup>
          {brand === BRAND_OTHER ? (
            <TextInput
              style={styles.input}
              value={brandOther}
              onChangeText={setBrandOther}
              placeholder="Which brand?"
              placeholderTextColor={colors.ink500}
              maxLength={MAX_BRAND_OTHER_LENGTH}
              accessibilityLabel="Brand name"
            />
          ) : null}
        </Collapsible>

        <Section title="Condition">
          <ChipGroup>
            {CONDITIONS.map((item) => (
              <Chip
                key={item}
                label={item}
                selected={condition === item}
                onPress={() => setCondition(item)}
              />
            ))}
          </ChipGroup>
        </Section>

        <Section title="Price">
          <View style={styles.priceRow}>
            <Text style={styles.euro}>€</Text>
            <TextInput
              style={[styles.input, styles.priceInput]}
              value={price}
              onChangeText={setPrice}
              placeholder="0"
              placeholderTextColor={colors.ink500}
              keyboardType={Platform.OS === "ios" ? "decimal-pad" : "numeric"}
              accessibilityLabel="Price in euro"
            />
          </View>
          <ChipGroup>
            {SALE_TYPES.map((item) => (
              <Chip
                key={item.value}
                label={item.label}
                selected={saleType === item.value}
                onPress={() => setSaleType(item.value)}
              />
            ))}
          </ChipGroup>
          <Text style={styles.hint}>
            {SALE_TYPES.find((item) => item.value === saleType)?.hint}{" "}
            Running an auction? That's set up on the website.
          </Text>
        </Section>

        <Section title="Getting it to the buyer">
          <ChipGroup>
            {DELIVERY_OPTIONS.map((item) => (
              <Chip
                key={item.value}
                label={item.label}
                selected={delivery.includes(item.value)}
                onPress={() =>
                  setDelivery((prev) =>
                    prev.includes(item.value)
                      ? prev.filter((value) => value !== item.value)
                      : [...prev, item.value]
                  )
                }
              />
            ))}
          </ChipGroup>
        </Section>

        <Collapsible
          label="Where it is"
          value={county}
          placeholder="Choose a county"
          open={open === "county"}
          onToggle={() => toggle("county")}
        >
          <ChipGroup>
            {COUNTRY_CODES.map((code) => (
              <Chip
                key={code}
                label={COUNTRY_NAMES[code] ?? code}
                selected={country === code}
                onPress={() => {
                  setCountry(code);
                  setCounty(null);
                }}
              />
            ))}
          </ChipGroup>
          <ChipGroup>
            {counties.map((item) => (
              <Chip
                key={item}
                label={item}
                selected={county === item}
                onPress={() => {
                  setCounty(item);
                  setOpen(null);
                }}
              />
            ))}
          </ChipGroup>
        </Collapsible>

        <Section
          title="Anything else?"
          hint="Optional. Wear and tear, what's included, why you're selling."
        >
          <TextInput
            style={[styles.input, styles.notes]}
            value={description}
            onChangeText={setDescription}
            placeholder="Bought new in 2024, headcover and tool included."
            placeholderTextColor={colors.ink500}
            multiline
            maxLength={MAX_DESCRIPTION_LENGTH}
            accessibilityLabel="Description"
          />
        </Section>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.post, (!complete || posting || uploading) && styles.postOff]}
          onPress={() => void post()}
          disabled={!complete || posting || uploading}
          accessibilityRole="button"
        >
          {posting ? (
            <ActivityIndicator color={colors.cream50} />
          ) : (
            <Text style={styles.postLabel}>
              {uploading ? "Waiting for photos…" : "Save and review"}
            </Text>
          )}
        </Pressable>

        <View style={styles.footnote}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.ink500} />
          <Text style={styles.footnoteLabel}>
            Saved as a draft. Nothing goes live until you publish it on the
            next screen.
          </Text>
        </View>
      </ScrollView>
      {/* Closes the keyboard from the multi-line fields (Return adds a line). */}
      <KeyboardDoneButton />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },

  // 16pt floor — iOS zooms the screen when a smaller input takes focus.
  input: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
  },
  notes: { minHeight: 96, textAlignVertical: "top" },

  priceRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  euro: { fontFamily: fonts.display, fontSize: 22, color: colors.ink900 },
  priceInput: { flex: 1 },

  hint: { fontFamily: fonts.body, fontSize: type.label, color: colors.ink500 },
  error: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600 },

  post: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    // The marketplace accent from globals.css. ink900 on it, never white:
    // white on buy500 is 1.99:1, nowhere near WCAG AA.
    backgroundColor: colors.buy500,
  },
  postOff: { opacity: 0.45 },
  postLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },

  footnote: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  footnoteLabel: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: type.label,
    color: colors.ink500,
  },
});
