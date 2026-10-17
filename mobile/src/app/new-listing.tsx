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

import { Chip, ChipGroup, Collapsible, Section, TileGrid } from "@/components/form-bits";
import { CATEGORY_TILES } from "@/lib/listing-icons";
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
  publishListing,
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
import { AgeGateLoading, NotForUnder18, useAgeGate } from "@/components/not-for-under-18";
import { useCashMarketplace } from "@/lib/marketplace-cash";
import { loadSmartBrands, similarAskingPrices } from "@/lib/listing-posts";
import { parseListingTitle, priceGuide, type ListingDraft, type SmartBrand } from "@/lib/smart-search";
import { matchModel, type FinderModel } from "@/lib/finder";
import { loadFinderModels } from "@/lib/gear-finder";

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

type OpenSection = "category" | "subcategory" | "brand" | "model" | "county" | null;

function NewListingScreenInner() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  // Cash marketplace (0160): no payouts to wait for, so it goes straight on
  // sale — one step, not "save, review, put on sale".
  const cash = useCashMarketplace();

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

  // ---- smart sell (approved mock-up 7): the title fills the form ---------
  // "taylormade qi10 driver 10.5 stiff" -> Drivers, TaylorMade, Qi10, 10.5°,
  // Stiff. Only fields the seller hasn't chosen themselves are filled.
  const [smartBrands, setSmartBrands] = useState<SmartBrand[]>([]);
  const [draft, setDraft] = useState<ListingDraft | null>(null);
  const [specs, setSpecs] = useState<{ model: string; loft: string; shaftFlex: string; shaftMaterial: string; dexterity: string }>({ model: "", loft: "", shaftFlex: "", shaftMaterial: "", dexterity: "" });
  const chose = useRef({ category: false, brand: false });
  // The catalogue model (0163): matched from the title, or picked — a pick
  // counts only for the brand and category it was made under.
  const [models, setModels] = useState<{ key: string; list: FinderModel[] }>({ key: "", list: [] });
  const [chosenModel, setChosenModel] = useState<{ key: string; id: string | null } | null>(null);
  const [guide, setGuide] = useState<{ lowCents: number; highCents: number; count: number } | null>(null);
  useEffect(() => {
    void loadSmartBrands().then(setSmartBrands);
  }, []);

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

  useEffect(() => {
    if (title.trim().length < 4) {
      setDraft(null);
      return;
    }
    const timer = setTimeout(() => {
      const d = parseListingTitle(title, smartBrands);
      setDraft(d.filled.length ? d : null);
      if (d.category && !chose.current.category && d.category !== category) {
        // The old category's brand list would otherwise clear the new brand.
        setBrands([]);
        setCategory(d.category as Category);
        setSubcategory(d.subcategory || null);
      }
      if (d.brand && !chose.current.brand) setBrand(d.brand);
      setSpecs({ model: d.model, loft: d.loft, shaftFlex: d.shaftFlex, shaftMaterial: d.shaftMaterial, dexterity: d.dexterity });
    }, 400);
    return () => clearTimeout(timer);
    // `category` is read only to skip a no-op change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, smartBrands]);

  const modelKey = category && brand && brand !== BRAND_OTHER ? `${brand}|${category}` : "";
  useEffect(() => {
    if (!modelKey) return;
    let live = true;
    const [b, c] = modelKey.split("|");
    void loadFinderModels(b, c).then((list) => live && setModels({ key: modelKey, list: [...list].sort((x, y) => (y.year ?? 0) - (x.year ?? 0)) }));
    return () => {
      live = false;
    };
  }, [modelKey]);
  const modelList = models.key === modelKey ? models.list : [];
  // Matched from the title until the seller picks one themselves.
  const picking = chosenModel?.key === modelKey;
  const matched = picking ? null : matchModel(modelList, `${title} ${specs.model}`);
  const pickedModel = modelList.find((m) => m.id === (picking ? chosenModel?.id : matched?.id)) ?? null;

  // "Similar ads are priced…" once there's a category (and a brand, if any).
  useEffect(() => {
    if (!category) {
      setGuide(null);
      return;
    }
    let live = true;
    void similarAskingPrices(category, brand && brand !== BRAND_OTHER ? brand : null, specs.model || null).then((prices) => {
      if (live) setGuide(priceGuide(prices));
    });
    return () => {
      live = false;
    };
  }, [category, brand, specs.model]);

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
        model: specs.model || null,
        modelId: pickedModel?.id ?? null,
        dexterity: specs.dexterity || null,
        shaftFlex: specs.shaftFlex || null,
        shaftMaterial: specs.shaftMaterial || null,
        loft: specs.loft || null,
      });

      // Cash marketplace: straight on sale through the same publish route
      // (which skips the payout check while payments are off). If that
      // fails, it's still a draft with "Put on sale" on the next screen.
      // With payments on: a draft, as before — the listing screen shows
      // "Put on sale" first, behind the same payment-readiness check.
      if (cash && created.imagesAttached) {
        await publishListing(created.listingId).catch(() => undefined);
      }
      router.replace({ pathname: "/listing/[id]", params: { id: String(created.listingId) } });

      if (!created.imagesAttached) {
        Alert.alert(
          "Listing saved, photos didn't",
          "The listing is there as a draft but the photos didn't attach. Tap \"Edit details and photos\" to add them before you put it on sale."
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
          {draft ? (
            <View style={styles.smart}>
              <View style={styles.smartHead}>
                <Ionicons name="sparkles" size={13} color="#8a6a1f" />
                <Text style={styles.smartEyebrow}>Filled in for you</Text>
              </View>
              <View style={styles.smartGrid}>
                {[
                  ["Category", category ? (subcategory ? `${category} · ${subcategory}` : category) : ""],
                  ["Brand · model", [brands.find((b) => b.id === brand)?.label ?? smartBrands.find((b) => b.id === brand)?.label, specs.model].filter(Boolean).join(" ")],
                  ["Loft", specs.loft],
                  ["Shaft", [specs.shaftFlex, specs.shaftMaterial].filter(Boolean).join(", ")],
                  ["Hand", specs.dexterity],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <View key={k} style={styles.smartCell}>
                      <Text style={styles.smartKey}>{k}</Text>
                      <Text style={styles.smartValue} numberOfLines={1}>{v}</Text>
                    </View>
                  ))}
              </View>
              {draft.title && draft.title !== title.trim() && draft.category ? (
                <Pressable onPress={() => setTitle(draft.title)} style={styles.smartTidy} accessibilityRole="button" accessibilityLabel={`Use the title ${draft.title}`}>
                  <Text style={styles.smartTidyText} numberOfLines={2}>
                    Use “{draft.title}”
                  </Text>
                </Pressable>
              ) : null}
              <Text style={styles.hint}>Change any of these below.</Text>
            </View>
          ) : null}
        </Section>

        <Section title="Category">
          <TileGrid
            tiles={CATEGORY_TILES}
            selected={category}
            onPick={(key) => {
              chose.current.category = true;
              setCategory(key as Category);
              setSubcategory(null);
              setBrand(null);
              setOpen(null);
            }}
          />
        </Section>

        <Collapsible
          label="Type"
          icon="options-outline"
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
          icon="ribbon-outline"
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
                  chose.current.brand = true;
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

        {modelList.length > 0 ? (
          <Collapsible
            label="Model"
            icon="pricetag-outline"
            value={pickedModel ? `${pickedModel.family}${pickedModel.year ? ` (${pickedModel.year})` : ""}` : null}
            placeholder="Helps buyers find it"
            open={open === "model"}
            onToggle={() => toggle("model")}
          >
            <Text style={styles.hint}>
              Buyers can pick the exact model — choosing it here puts your advert in front of them.
            </Text>
            <ChipGroup>
              {modelList.map((m) => (
                <Chip
                  key={m.id}
                  label={m.year ? `${m.family} · ${m.year}` : m.family}
                  selected={pickedModel?.id === m.id}
                  onPress={() => {
                    setChosenModel({ key: modelKey, id: pickedModel?.id === m.id ? null : m.id });
                    setOpen(null);
                  }}
                />
              ))}
            </ChipGroup>
          </Collapsible>
        ) : null}

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
          {guide ? (
            <Pressable
              onPress={() => setPrice(String(Math.round((guide.lowCents + guide.highCents) / 200 / 5) * 5))}
              style={styles.guide}
              accessibilityRole="button"
              accessibilityLabel={`Similar ads are priced ${guide.lowCents / 100} to ${guide.highCents / 100} euro. Tap to use the middle.`}
            >
              <Text style={styles.guideText}>
                Similar ads on PinPals: <Text style={styles.guideBold}>€{guide.lowCents / 100}–€{guide.highCents / 100}</Text>
              </Text>
              <Text style={styles.guideUse}>Use €{Math.round((guide.lowCents + guide.highCents) / 200 / 5) * 5}</Text>
            </Pressable>
          ) : null}
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
          icon="location-outline"
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
              {uploading ? "Waiting for photos…" : cash ? "Post listing · it's free" : "Save and review"}
            </Text>
          )}
        </Pressable>

        <View style={styles.footnote}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.ink500} />
          <Text style={styles.footnoteLabel}>
            {cash
              ? "Goes live straight away. Buyers message you, you meet up, and they pay you in cash or by Revolut."
              : "Saved as a draft. Nothing goes live until you tap Put on sale on the next screen."}
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
  smart: { marginTop: 10, padding: 12, gap: 10, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.gold500, backgroundColor: colors.surface },
  smartHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  smartEyebrow: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, textTransform: "uppercase", color: "#8a6a1f" },
  smartGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  smartCell: { flexBasis: "47%", flexGrow: 1, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.cream50, borderWidth: 1, borderColor: colors.line },
  smartKey: { fontFamily: fonts.body, fontSize: 11.5, color: colors.ink500 },
  smartValue: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
  smartTidy: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.green100 },
  smartTidyText: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.green800 },
  guide: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radii.md, backgroundColor: colors.green100 },
  guideText: { flex: 1, fontFamily: fonts.body, fontSize: 13.5, color: colors.green800 },
  guideBold: { fontFamily: fonts.bodyBold },
  guideUse: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.green700 },
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

/** Junior members (0159): selling aren't for every age — a deep link gets the panel, not a form the database would refuse. */
export default function NewListingScreen() {
  const gate = useAgeGate("sell");
  if (gate === "loading") return <AgeGateLoading />;
  if (gate === "blocked") return <NotForUnder18 feature="sell" title="Selling" />;
  return <NewListingScreenInner />;
}
