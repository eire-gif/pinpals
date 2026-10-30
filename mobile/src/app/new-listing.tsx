import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import { Chip, ChipGroup } from "@/components/form-bits";
import { PhotoStrip, type Photo } from "@/components/photo-strip";
import { ApiError, type UploadFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  BRAND_OTHER,
  CONDITIONS,
  DELIVERY_OPTIONS,
  MAX_BRAND_OTHER_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_LISTING_IMAGES,
  MAX_TITLE_LENGTH,
  SALE_TYPES,
  brandsFor,
  createListing,
  parsePrice,
  publishListing,
  sellerPlace,
  uploadPhoto,
  type Brand,
  type SaleType,
} from "@/lib/listings";
import { COUNTRY_NAMES, regionsFor } from "@/lib/tee-time-post";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { FORM_SCROLL_KEYBOARD, KeyboardDoneButton } from "@/components/keyboard";
import { PHOTO_PICKER_OPTIONS, preparePhotoForUpload } from "@/lib/photo-picking";
import { AgeGateLoading, NotForUnder18, useAgeGate } from "@/components/not-for-under-18";
import { useCashMarketplace } from "@/lib/marketplace-cash";
import { loadSmartBrands, similarAskingPrices } from "@/lib/listing-posts";
import { parseListingTitle, priceGuide, type SmartBrand } from "@/lib/smart-search";
import { matchModel, type FinderModel } from "@/lib/finder";
import { loadFinderBrands, loadFinderModels, type FinderBrand } from "@/lib/gear-finder";
import {
  BRAND_TILES,
  CONDITION_HINTS,
  LOFT_CHOICES,
  SELL_STEPS,
  SELL_TILES,
  modelQuestion,
  subcategoryFor,
  tileByKey,
  tileFor,
  writeTitle,
  type SellTile,
} from "@/lib/sell-flow";
import { supabase } from "@/lib/supabase";

/**
 * Selling, step by step (Oct 2026, approved mock-ups "Selling, rebuilt").
 *
 * Six screens, one question each, in the order buyers search — so every ad
 * lands in the right place when buyers find gear by club, brand and model:
 *
 *   1 Photos and a description · 2 What is it (clubs, and everything else
 *   golf) · 3 Brand · 4 Model · 5 Details · 6 Price and post.
 *
 * Typing it on step 2 ("tm qi10 driver 10.5 stiff") fills steps 2–5 in.
 * A brand or model that isn't listed is typed in; the ad uses it straight
 * away, and the catalogue learns it once enough sellers type the same thing
 * (0164). The tiles and the title rules are shared with the website
 * (lib/sell-flow.ts).
 *
 * Photos go up as they're picked, so a failure is one thumbnail to retry.
 * With payments off it goes straight on sale; otherwise it saves a draft and
 * opens the listing, where publishing re-checks the seller can take money.
 */

const COUNTRY_CODES = ["ireland", "northern-ireland", "england", "scotland", "wales", "spain", "portugal"] as const;

const TILE_ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  drivers: "golf",
  woods: "golf-tee",
  irons: "numeric-7-box-outline",
  wedges: "angle-acute",
  putters: "flag-variant",
  sets: "layers-triple",
  bags: "bag-personal-outline",
  trolleys: "golf-cart",
  shoes: "shoe-sneaker",
  clothing: "tshirt-crew-outline",
  gps: "crosshairs-gps",
  balls: "circle-slice-8",
  accessories: "tag-outline",
  training: "target",
  other: "dots-horizontal",
};

/** Which details each kind of item asks for — mirrors SPEC_FIELDS_BY_CATEGORY on the website. */
type Spec = "loft" | "flex" | "material" | "hand" | "size";
const SPECS: Record<string, readonly Spec[]> = {
  Drivers: ["loft", "flex", "material", "hand"],
  "Woods & hybrids": ["loft", "flex", "material", "hand"],
  Irons: ["loft", "flex", "material", "hand"],
  Wedges: ["loft", "flex", "material", "hand"],
  Putters: ["hand", "loft"],
  "Full sets": ["flex", "material", "hand"],
  "Bags & trolleys": [],
  "Shoes & apparel": ["size"],
  "Balls & accessories": [],
};
const FLEXES = ["Ladies", "Senior", "Regular", "Stiff", "Extra stiff"] as const;
const MATERIALS = ["Steel", "Graphite", "Multi-material"] as const;
const HANDS = ["Right-handed", "Left-handed"] as const;
const FALLBACK_IDS = ["other", "unknown", "mixed"];
const PROMPTS = ["How long you've had it", "Any marks", "What's included"];

function NewListingScreenInner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const cash = useCashMarketplace();
  // From the finder's "Sell yours": the club type, brand and model already picked.
  const params = useLocalSearchParams<{ category?: string; brand?: string; model?: string; camera?: string }>();
  const startTile = params.category ? tileFor(params.category) : undefined;
  const scroll = useRef<ScrollView>(null);

  const [step, setStep] = useState(0);

  // ---- step 1: photos and a description --------------------------------
  const [photos, setPhotos] = useState<Photo[]>([]);
  const files = useRef(new Map<string, UploadFile>());
  const [description, setDescription] = useState("");

  // ---- step 2: what is it ------------------------------------------------
  const [tileKey, setTileKey] = useState(startTile?.key ?? "");
  const [kind, setKind] = useState(startTile?.kinds?.[0]?.subcategory ?? "");
  const [typed, setTyped] = useState("");
  const [smartBrands, setSmartBrands] = useState<SmartBrand[]>([]);
  const tile = tileByKey(tileKey);
  const category = tile?.category ?? "";
  const subcategory = tile ? subcategoryFor(tile, kind) : "";

  // ---- step 3: brand -----------------------------------------------------
  const [brand, setBrand] = useState(params.brand ?? "");
  const [brandOther, setBrandOther] = useState("");
  const [brands, setBrands] = useState<{ key: string; list: Brand[] }>({ key: "", list: [] });
  const [logos, setLogos] = useState<Map<string, FinderBrand>>(new Map());
  const [brandSearch, setBrandSearch] = useState("");
  const [allBrands, setAllBrands] = useState(false);
  const [suggestedBrands, setSuggestedBrands] = useState<{ key: string; list: string[] }>({ key: "", list: [] });

  // ---- step 4: model -----------------------------------------------------
  const [models, setModels] = useState<{ key: string; list: FinderModel[]; suggested: string[] }>({ key: "", list: [], suggested: [] });
  const [modelId, setModelId] = useState(params.model ?? "");
  const [modelText, setModelText] = useState("");
  const [typingModel, setTypingModel] = useState(false);
  const [olderModels, setOlderModels] = useState(false);

  // ---- step 5: details ---------------------------------------------------
  const [condition, setCondition] = useState<string | null>(null);
  const [loft, setLoft] = useState("");
  const [flex, setFlex] = useState("");
  const [material, setMaterial] = useState("");
  const [hand, setHand] = useState("");
  const [size, setSize] = useState("");

  // ---- step 6: price and post --------------------------------------------
  const [title, setTitle] = useState("");
  const [titleEdited, setTitleEdited] = useState(false);
  const [price, setPrice] = useState("");
  const [saleType, setSaleType] = useState<SaleType>("offers_allowed");
  const [delivery, setDelivery] = useState<string[]>(["collection"]);
  const [country, setCountry] = useState<string>("ireland");
  const [county, setCounty] = useState<string | null>(null);
  const [counties, setCounties] = useState<string[]>([]);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [guide, setGuide] = useState<{ lowCents: number; highCents: number; count: number } | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadSmartBrands().then(setSmartBrands);
    void loadFinderBrands().then(setLogos);
  }, []);

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

  // Brands for this kind of item (curated + learned from sellers), and the ones sellers keep typing.
  const brandKey = category ? `${category}|${subcategory}` : "";
  useEffect(() => {
    if (!brandKey) return;
    let live = true;
    const [c, s] = brandKey.split("|");
    void brandsFor(c, s || null).then((list) => live && setBrands({ key: brandKey, list }));
    void supabase
      .rpc("marketplace_member_suggestions", { p_category: c, p_brand: null })
      .then(({ data, error: e }) => live && setSuggestedBrands({ key: brandKey, list: e ? [] : ((data ?? []) as { label: string }[]).map((x) => x.label) }));
    return () => {
      live = false;
    };
  }, [brandKey]);

  const realBrand = !!brand && !FALLBACK_IDS.includes(brand);
  const modelKey = category && realBrand ? `${brand}|${category}` : "";
  useEffect(() => {
    if (!modelKey) return;
    let live = true;
    const [b, c] = modelKey.split("|");
    void Promise.all([loadFinderModels(b, c), supabase.rpc("marketplace_member_suggestions", { p_category: c, p_brand: b })]).then(([list, s]) => {
      if (!live) return;
      setModels({
        key: modelKey,
        list: [...list].sort((x, y) => (y.year ?? 0) - (x.year ?? 0) || x.family.localeCompare(y.family)),
        suggested: s.error ? [] : ((s.data ?? []) as { label: string }[]).map((x) => x.label),
      });
    });
    return () => {
      live = false;
    };
  }, [modelKey]);

  const brandList = brands.key === brandKey ? brands.list : [];
  const realBrands = brandList.filter((b) => !FALLBACK_IDS.includes(b.id));
  const fallbackBrands = brandList.filter((b) => FALLBACK_IDS.includes(b.id));
  const brandLabel =
    brand === BRAND_OTHER
      ? brandOther.trim()
      : brand === "unknown" || brand === "mixed"
        ? ""
        : (brandList.find((b) => b.id === brand)?.label ?? smartBrands.find((b) => b.id === brand)?.label ?? logos.get(brand)?.label ?? "");
  const modelList = models.key === modelKey ? models.list : [];
  const suggestedModels = models.key === modelKey ? models.suggested : [];
  const picked = modelList.find((m) => m.id === modelId) ?? null;
  const modelName = modelText && picked && !modelText.toLowerCase().includes(picked.family.toLowerCase()) ? `${picked.family} ${modelText}` : modelText || picked?.family || "";
  const specs = SPECS[category] ?? [];
  const autoTitle = writeTitle({
    brandLabel,
    model: modelName,
    tile,
    kind: subcategory,
    loft: specs.includes("loft") ? loft : "",
    flex: specs.includes("flex") ? flex : "",
    size: specs.includes("size") ? size : "",
    hand: specs.includes("hand") ? hand : "",
  });
  const shownTitle = titleEdited ? title : autoTitle;

  // "Similar ads on PinPals" once there's a category (and a brand, if any).
  useEffect(() => {
    if (!category) return;
    let live = true;
    void similarAskingPrices(category, realBrand ? brand : null, modelName || null).then((prices) => {
      if (live) setGuide(priceGuide(prices));
    });
    return () => {
      live = false;
    };
  }, [category, brand, realBrand, modelName]);

  // ---- photos ------------------------------------------------------------

  const send = useCallback(async (id: string, file: UploadFile) => {
    files.current.set(id, file);
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, status: "uploading", error: undefined } : p)));
    try {
      const uploaded = await uploadPhoto(file);
      setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, status: "done", uploaded } : p)));
    } catch (err) {
      setPhotos((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: "failed", error: err instanceof ApiError ? err.message : "Couldn't upload that photo." } : p))
      );
    }
  }, []);

  const add = useCallback(
    (assets: ImagePicker.ImagePickerAsset[]) => {
      for (const asset of assets) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const file: UploadFile = { uri: asset.uri, name: asset.fileName ?? `photo-${id}.jpg`, type: asset.mimeType ?? "image/jpeg" };
        setPhotos((prev) => [...prev, { id, uri: asset.uri, status: "uploading" }]);
        void preparePhotoForUpload({ ...file, width: asset.width, height: asset.height }).then((ready) => send(id, ready));
      }
    },
    [send]
  );

  const capture = useCallback(
    async (source: "camera" | "library") => {
      const permission = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(source === "camera" ? "Camera is off" : "Photos are off", "PinPals needs this to add photos to your listing. You can turn it on in Settings.", [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => void Linking.openSettings() },
        ]);
        return;
      }
      const remaining = MAX_LISTING_IMAGES - photos.length;
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync(PHOTO_PICKER_OPTIONS)
          : await ImagePicker.launchImageLibraryAsync({ ...PHOTO_PICKER_OPTIONS, allowsMultipleSelection: true, selectionLimit: remaining });
      if (result.canceled) return;
      add(result.assets.slice(0, remaining));
    },
    [add, photos.length]
  );

  // ?camera=1 — the camera on Chats, "Sell it" (Oct 2026): the camera
  // opens as the listing does, once.
  const cameraAsked = useRef(false);
  useEffect(() => {
    if (params.camera !== "1" || cameraAsked.current) return;
    cameraAsked.current = true;
    void capture("camera");
  }, [params.camera, capture]);

  const pick = () =>
    Alert.alert("Add a photo", undefined, [
      { text: "Take a photo", onPress: () => void capture("camera") },
      { text: "Choose from library", onPress: () => void capture("library") },
      { text: "Cancel", style: "cancel" },
    ]);

  const remove = (id: string) => {
    files.current.delete(id);
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  };
  const retry = (id: string) => {
    const file = files.current.get(id);
    if (file) void send(id, file);
  };

  // ---- typing it fills steps 2–5 ------------------------------------------

  const fillFromTyped = () => {
    const d = parseListingTitle(typed, smartBrands);
    if (d.category) {
      const t = tileFor(d.category, d.subcategory);
      if (t) {
        setTileKey(t.key);
        setKind(t.kinds?.find((k) => k.subcategory === d.subcategory)?.subcategory ?? t.kinds?.[0]?.subcategory ?? "");
      }
    }
    if (d.brand) setBrand(d.brand);
    setModelId("");
    setModelText(d.model);
    if (d.loft) setLoft(d.loft);
    if (d.shaftFlex) setFlex(d.shaftFlex);
    if (d.shaftMaterial) setMaterial(d.shaftMaterial);
    if (d.dexterity) setHand(d.dexterity);
    if (d.category) go(d.brand ? 3 : 2);
  };

  // A typed model name that matches the catalogue becomes that model, once it's loaded.
  const matchedFromText = !modelId && modelText && modelList.length ? matchModel(modelList, modelText) : null;
  const effectiveModelId = modelId || matchedFromText?.id || "";

  // ---- moving between steps ---------------------------------------------

  const go = (next: number) => {
    setStep(next);
    setError(null);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  const uploading = photos.some((p) => p.status === "uploading");
  const ready = photos.filter((p) => p.status === "done" && p.uploaded);
  const priceValue = parsePrice(price);
  const canNext = [ready.length > 0 && !uploading, !!tile, brand !== BRAND_OTHER || brandOther.trim().length > 0, true, !!condition, true];
  const complete =
    ready.length > 0 && shownTitle.trim().length >= 3 && !!category && !!condition && !!county && delivery.length > 0 && priceValue !== null;

  const post = async () => {
    if (!complete || posting || uploading || !condition || !county) return;
    setPosting(true);
    setError(null);
    try {
      const created = await createListing({
        title: shownTitle.trim(),
        description: description.trim(),
        category,
        subcategory,
        condition,
        county,
        brand: brand || null,
        brandOther: brand === BRAND_OTHER ? brandOther.trim() : null,
        saleType,
        priceEur: priceValue!,
        deliveryOptions: delivery,
        images: ready.map((p) => p.uploaded!),
        model: modelName || null,
        modelId: effectiveModelId || null,
        dexterity: specs.includes("hand") ? hand || null : null,
        shaftFlex: specs.includes("flex") ? flex || null : null,
        shaftMaterial: specs.includes("material") ? material || null : null,
        loft: specs.includes("loft") ? loft || null : null,
        itemSize: specs.includes("size") ? size || null : null,
      });
      if (cash && created.imagesAttached) {
        await publishListing(created.listingId).catch(() => undefined);
      }
      router.replace({ pathname: "/listing/[id]", params: { id: String(created.listingId) } });
      if (!created.imagesAttached) {
        Alert.alert("Listing saved, photos didn't", 'The listing is there as a draft but the photos didn\'t attach. Tap "Edit details and photos" to add them before you put it on sale.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't post that listing.");
      setPosting(false);
    }
  };

  // ---- the steps ---------------------------------------------------------

  const term = brandSearch.trim().toLowerCase();
  const brandMatches = term ? realBrands.filter((b) => b.label.toLowerCase().includes(term)) : [];
  const brandRest = useMemo(
    () => [...realBrands.slice(BRAND_TILES)].sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" })),
    [realBrands]
  );
  const recentModels = modelList.filter((m) => (m.year ?? 0) >= new Date().getFullYear() - 5);
  const shownModels = olderModels || recentModels.length < 4 ? modelList : recentModels;
  const pickedModel = modelList.find((m) => m.id === effectiveModelId) ?? null;
  const cover = ready[0]?.uri ?? photos[0]?.uri ?? null;

  const pickBrand = (id: string, other = "") => {
    if (id !== brand) {
      setModelId("");
      setModelText("");
      setTypingModel(false);
    }
    setBrand(id);
    setBrandOther(other);
  };

  const tileButton = (t: SellTile) => {
    const on = t.key === tileKey;
    return (
      <Pressable
        key={t.key}
        onPress={() => {
          setTileKey(t.key);
          setKind(t.kinds?.[0]?.subcategory ?? "");
          if (t.category !== category) pickBrand("");
        }}
        style={[styles.tile, on && styles.tileOn]}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={t.label}
      >
        {on ? (
          <View style={styles.tick}>
            <Ionicons name="checkmark" size={12} color="#fff" />
          </View>
        ) : null}
        <MaterialCommunityIcons name={TILE_ICONS[t.key] ?? "golf"} size={24} color={colors.green700} />
        <Text style={styles.tileLabel} numberOfLines={2}>
          {t.label}
        </Text>
      </Pressable>
    );
  };

  const body = [
    // 1 Photos and a description
    <View key="photos" style={styles.stepBody}>
      <PhotoStrip photos={photos} max={MAX_LISTING_IMAGES} onAdd={pick} onRemove={remove} onRetry={retry} />
      <Text style={styles.hint}>Daylight, the face and any marks. The first photo is the cover.</Text>
      <View style={styles.field}>
        <View style={styles.rowBetween}>
          <Text style={styles.label}>Description</Text>
          <Text style={styles.hint}>
            {description.length} / {MAX_DESCRIPTION_LENGTH}
          </Text>
        </View>
        <TextInput
          style={[styles.input, styles.notes]}
          value={description}
          onChangeText={setDescription}
          placeholder="Played one season, always in the headcover. Small mark on the crown, face is perfect."
          placeholderTextColor={colors.ink500}
          multiline
          maxLength={MAX_DESCRIPTION_LENGTH}
          accessibilityLabel="Description"
        />
        <ChipGroup>
          {PROMPTS.map((p) => (
            <Chip key={p} label={`+ ${p}`} selected={false} onPress={() => setDescription((d) => `${d}${d && !d.endsWith(" ") && !d.endsWith("\n") ? "\n" : ""}${p}: `)} />
          ))}
        </ChipGroup>
      </View>
    </View>,

    // 2 What is it
    <View key="item" style={styles.stepBody}>
      <View style={styles.typedRow}>
        <Ionicons name="sparkles" size={15} color="#8a6a1f" />
        <TextInput
          style={styles.typedInput}
          value={typed}
          onChangeText={setTyped}
          onSubmitEditing={fillFromTyped}
          returnKeyType="go"
          placeholder="Or type it — “tm qi10 driver 10.5 stiff”"
          placeholderTextColor={colors.ink500}
          accessibilityLabel="Type what you're selling"
        />
        {typed.trim().length > 3 ? (
          <Pressable onPress={fillFromTyped} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>Fill in</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.groupLabel}>CLUBS</Text>
      <View style={styles.tiles}>{SELL_TILES.filter((t) => t.group === "clubs").map(tileButton)}</View>
      <Text style={styles.groupLabel}>EVERYTHING ELSE GOLF</Text>
      <View style={styles.tiles}>{SELL_TILES.filter((t) => t.group === "other").map(tileButton)}</View>
      {tile?.kinds ? (
        <View style={styles.card}>
          <Text style={styles.label}>Which kind?</Text>
          <ChipGroup>
            {tile.kinds.map((k) => (
              <Chip key={k.subcategory} label={k.label} selected={subcategory === k.subcategory} onPress={() => setKind(k.subcategory)} />
            ))}
          </ChipGroup>
        </View>
      ) : null}
    </View>,

    // 3 Brand
    <View key="brand" style={styles.stepBody}>
      <View style={styles.search}>
        <Ionicons name="search" size={18} color={colors.ink500} />
        <TextInput
          style={styles.searchInput}
          value={brandSearch}
          onChangeText={setBrandSearch}
          placeholder={realBrands.length ? `Search ${realBrands.length} brands` : "Search brands"}
          placeholderTextColor={colors.ink500}
          accessibilityLabel="Search brands"
        />
      </View>
      {term ? (
        <View style={styles.list}>
          {brandMatches.length ? (
            brandMatches.map((b) => <ListRow key={b.id} label={b.label} on={brand === b.id} onPress={() => pickBrand(b.id)} />)
          ) : (
            <Text style={[styles.hint, { padding: 12 }]}>Not on our list — tap “Not listed” below and type it.</Text>
          )}
        </View>
      ) : (
        <>
          <Text style={styles.groupLabel}>MOST LISTED</Text>
          <View style={styles.tiles}>
            {realBrands.slice(0, BRAND_TILES).map((b) => {
              const on = brand === b.id;
              const logo = logos.get(b.id)?.logoUrl;
              return (
                <Pressable key={b.id} onPress={() => pickBrand(b.id)} style={[styles.logoTile, on && styles.logoTileOn]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={b.label}>
                  {logo ? <Image source={{ uri: logo }} style={styles.logo} resizeMode="contain" /> : <Text style={[styles.logoText, b.label.length > 9 && { fontSize: 12 }]} numberOfLines={2}>{b.label}</Text>}
                  {on ? (
                    <View style={styles.tick}>
                      <Ionicons name="checkmark" size={12} color="#fff" />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          {(suggestedBrands.key === brandKey ? suggestedBrands.list : []).length > 0 ? (
            <>
              <Text style={styles.groupLabel}>SUGGESTED BY MEMBERS</Text>
              <ChipGroup>
                {suggestedBrands.list.map((label) => (
                  <Chip key={label} label={label} selected={brand === BRAND_OTHER && brandOther.toLowerCase() === label.toLowerCase()} onPress={() => pickBrand(BRAND_OTHER, label)} />
                ))}
              </ChipGroup>
            </>
          ) : null}
          {brandRest.length > 0 ? (
            <>
              <Pressable onPress={() => setAllBrands((v) => !v)} hitSlop={8} accessibilityRole="button" style={styles.rowBetween}>
                <Text style={styles.groupLabel}>ALL BRANDS A–Z</Text>
                <Text style={styles.link}>{allBrands ? "Hide" : `Show ${brandRest.length}`}</Text>
              </Pressable>
              {allBrands ? (
                <View style={styles.list}>
                  {brandRest.map((b) => (
                    <ListRow key={b.id} label={b.label} on={brand === b.id} onPress={() => pickBrand(b.id)} />
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
        </>
      )}
      <ChipGroup>
        {fallbackBrands.map((b) => (
          <Chip key={b.id} label={b.id === BRAND_OTHER ? "Not listed — type it" : b.label} selected={brand === b.id} onPress={() => pickBrand(b.id, b.id === BRAND_OTHER ? brandOther : "")} />
        ))}
      </ChipGroup>
      {brand === BRAND_OTHER ? (
        <View style={styles.field}>
          <TextInput
            style={styles.input}
            value={brandOther}
            onChangeText={setBrandOther}
            placeholder="Brand name, as it's written on it"
            placeholderTextColor={colors.ink500}
            maxLength={MAX_BRAND_OTHER_LENGTH}
            accessibilityLabel="Brand name"
          />
          <Text style={styles.hint}>Your ad uses it straight away. When a few sellers type the same brand, it joins the list for everyone.</Text>
        </View>
      ) : null}
    </View>,

    // 4 Model
    <View key="model" style={styles.stepBody}>
      {!realBrand || modelList.length === 0 ? (
        <View style={styles.field}>
          <Text style={styles.label}>Model (optional)</Text>
          <TextInput
            style={styles.input}
            value={modelText}
            onChangeText={(t) => {
              setModelId("");
              setModelText(t);
            }}
            placeholder="As it's written on the item"
            placeholderTextColor={colors.ink500}
            maxLength={80}
            accessibilityLabel="Model"
          />
        </View>
      ) : (
        <>
          {shownModels.map((m) => {
            const on = m.id === effectiveModelId;
            return (
              <View key={m.id}>
                <Pressable
                  onPress={() => {
                    setTypingModel(false);
                    setModelId(on ? "" : m.id);
                    setModelText(on || m.versions.length ? "" : m.family);
                  }}
                  style={[styles.modelRow, on && styles.modelRowOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${m.family}${m.year ? `, ${m.year}` : ""}`}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={styles.modelHead}>
                      {m.year ? <Text style={styles.year}>{m.year}</Text> : null}
                      <Text style={styles.modelName}>{m.family}</Text>
                    </View>
                    {m.versions.length ? (
                      <Text style={styles.hint} numberOfLines={1}>
                        {m.versions.slice(0, 4).join(" · ")}
                      </Text>
                    ) : null}
                  </View>
                  {on ? (
                    <View style={[styles.tick, { position: "relative", top: 0, right: 0 }]}>
                      <Ionicons name="checkmark" size={12} color="#fff" />
                    </View>
                  ) : null}
                </Pressable>
                {on && m.versions.length > 0 ? (
                  <View style={[styles.card, { marginTop: 8 }]}>
                    <Text style={styles.label}>Which {m.family}?</Text>
                    <ChipGroup>
                      {m.versions.map((v) => (
                        <Chip key={v} label={v} selected={modelText === v} onPress={() => setModelText(modelText === v ? "" : v)} />
                      ))}
                    </ChipGroup>
                  </View>
                ) : null}
              </View>
            );
          })}
          {shownModels.length < modelList.length ? (
            <Pressable onPress={() => setOlderModels(true)} hitSlop={8} accessibilityRole="button">
              <Text style={styles.link}>Older models ({modelList.length - shownModels.length})</Text>
            </Pressable>
          ) : null}
          {suggestedModels.length > 0 ? (
            <>
              <Text style={styles.groupLabel}>SUGGESTED BY MEMBERS</Text>
              <ChipGroup>
                {suggestedModels.map((label) => (
                  <Chip
                    key={label}
                    label={label}
                    selected={!modelId && modelText === label}
                    onPress={() => {
                      setTypingModel(false);
                      setModelId("");
                      setModelText(modelText === label ? "" : label);
                    }}
                  />
                ))}
              </ChipGroup>
            </>
          ) : null}
          <View style={styles.rowBetween}>
            <Pressable
              onPress={() => {
                setTypingModel(true);
                setModelId("");
                if (suggestedModels.includes(modelText)) setModelText("");
              }}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={styles.link}>Not listed — type it</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setTypingModel(false);
                setModelId("");
                setModelText("");
              }}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={[styles.link, { color: colors.ink500 }]}>Not sure</Text>
            </Pressable>
          </View>
          {typingModel || (!effectiveModelId && !!modelText && !suggestedModels.includes(modelText)) ? (
            <View style={styles.field}>
              <TextInput
                style={styles.input}
                value={modelText}
                onChangeText={(t) => {
                  setModelId("");
                  setModelText(t);
                }}
                placeholder="Model name, as it's written on it"
                placeholderTextColor={colors.ink500}
                maxLength={80}
                autoFocus={typingModel}
                accessibilityLabel="Model name"
              />
              <Text style={styles.hint}>Your ad uses it straight away. When a few sellers type the same model, it joins the list for everyone.</Text>
            </View>
          ) : null}
        </>
      )}
    </View>,

    // 5 Details
    <View key="details" style={styles.stepBody}>
      <Text style={styles.label}>Condition</Text>
      {CONDITIONS.map((c) => {
        const on = condition === c;
        return (
          <Pressable key={c} onPress={() => setCondition(c)} style={[styles.condition, on && styles.conditionOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
            <View style={[styles.radio, on && styles.radioOn]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.conditionName}>{c}</Text>
              <Text style={styles.hint}>{CONDITION_HINTS[c]}</Text>
            </View>
          </Pressable>
        );
      })}
      {specs.includes("loft") ? (
        <View style={styles.field}>
          <Text style={styles.label}>Loft</Text>
          <ChipGroup>
            {(LOFT_CHOICES[category] ?? []).map((l) => (
              <Chip key={l} label={l} selected={loft === l} onPress={() => setLoft(loft === l ? "" : l)} />
            ))}
          </ChipGroup>
          <TextInput style={[styles.input, { maxWidth: 160 }]} value={loft} onChangeText={setLoft} placeholder="Other" placeholderTextColor={colors.ink500} maxLength={24} accessibilityLabel="Loft" />
        </View>
      ) : null}
      {specs.includes("flex") ? (
        <View style={styles.field}>
          <Text style={styles.label}>Shaft flex</Text>
          <ChipGroup>
            {FLEXES.map((f) => (
              <Chip key={f} label={f} selected={flex === f} onPress={() => setFlex(flex === f ? "" : f)} />
            ))}
          </ChipGroup>
        </View>
      ) : null}
      {specs.includes("material") ? (
        <View style={styles.field}>
          <Text style={styles.label}>Shaft</Text>
          <ChipGroup>
            {MATERIALS.map((m) => (
              <Chip key={m} label={m} selected={material === m} onPress={() => setMaterial(material === m ? "" : m)} />
            ))}
          </ChipGroup>
        </View>
      ) : null}
      {specs.includes("hand") ? (
        <View style={styles.field}>
          <Text style={styles.label}>Hand</Text>
          <ChipGroup>
            {HANDS.map((h) => (
              <Chip key={h} label={h} selected={hand === h} onPress={() => setHand(hand === h ? "" : h)} />
            ))}
          </ChipGroup>
        </View>
      ) : null}
      {specs.includes("size") ? (
        <View style={styles.field}>
          <Text style={styles.label}>Size</Text>
          <TextInput style={[styles.input, { maxWidth: 200 }]} value={size} onChangeText={setSize} placeholder={tileKey === "shoes" ? "e.g. UK 9" : "e.g. M, L, XL"} placeholderTextColor={colors.ink500} maxLength={24} accessibilityLabel="Size" />
        </View>
      ) : null}
    </View>,

    // 6 Price and post
    <View key="price" style={styles.stepBody}>
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
        {SALE_TYPES.map((s) => (
          <Chip key={s.value} label={s.label} selected={saleType === s.value} onPress={() => setSaleType(s.value)} />
        ))}
      </ChipGroup>

      <View style={styles.field}>
        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.input}
          value={shownTitle}
          onChangeText={(t) => {
            setTitle(t);
            setTitleEdited(true);
          }}
          placeholder="What it is"
          placeholderTextColor={colors.ink500}
          maxLength={MAX_TITLE_LENGTH}
          accessibilityLabel="Title"
        />
        <Text style={styles.hint}>Written for you — change it if you like.</Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Getting it to the buyer</Text>
        <ChipGroup>
          {DELIVERY_OPTIONS.map((d) => (
            <Chip
              key={d.value}
              label={d.label}
              selected={delivery.includes(d.value)}
              onPress={() => setDelivery((prev) => (prev.includes(d.value) ? prev.filter((v) => v !== d.value) : [...prev, d.value]))}
            />
          ))}
        </ChipGroup>
      </View>

      <Pressable onPress={() => setPlaceOpen((v) => !v)} style={styles.placeRow} accessibilityRole="button" accessibilityLabel={`Where it is: ${county ?? "choose a county"}`}>
        <Ionicons name="location-outline" size={18} color={colors.green700} />
        <Text style={[styles.label, { flex: 1 }]}>{county ?? "Choose a county"}</Text>
        <Text style={styles.link}>{placeOpen ? "Done" : "Change"}</Text>
      </Pressable>
      {placeOpen ? (
        <View style={styles.field}>
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
            {counties.map((c) => (
              <Chip
                key={c}
                label={c}
                selected={county === c}
                onPress={() => {
                  setCounty(c);
                  setPlaceOpen(false);
                }}
              />
            ))}
          </ChipGroup>
        </View>
      ) : null}

      <Text style={styles.groupLabel}>HOW BUYERS WILL SEE IT</Text>
      <View style={styles.preview}>
        {cover ? <Image source={{ uri: cover }} style={styles.previewImage} /> : <View style={[styles.previewImage, { backgroundColor: colors.cream100 }]} />}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.previewCrumb} numberOfLines={1}>
            {[category, brandLabel, pickedModel?.family].filter(Boolean).join(" · ").toUpperCase()}
          </Text>
          <Text style={styles.previewTitle} numberOfLines={2}>
            {shownTitle || "Your title"}
          </Text>
          <Text style={styles.previewPrice}>{priceValue !== null ? `€${priceValue}` : "€ —"}</Text>
          {condition ? <Text style={styles.hint}>{condition}</Text> : null}
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.footnote}>
        <Ionicons name="lock-closed-outline" size={14} color={colors.ink500} />
        <Text style={styles.footnoteLabel}>
          {cash
            ? "Goes live straight away. Buyers message you, you meet up, and they pay you in cash or by Revolut."
            : "Saved as a draft. Nothing goes live until you tap Put on sale on the next screen."}
        </Text>
      </View>
    </View>,
  ];

  const titles = [
    "Show it and say a bit about it",
    "What are you selling?",
    "Which brand?",
    modelQuestion(brandLabel, tile),
    "Tell buyers about it",
    "Price it and post it",
  ];

  const nextLabel =
    step === 0
      ? uploading
        ? "Waiting for photos…"
        : ready.length === 0
          ? "Add a photo to go on"
          : "Next: what is it?"
      : step === 2 && !brand
        ? "Skip"
        : step === 3 && !modelName
          ? "Skip"
          : step === 5
            ? cash
              ? "Post listing · it's free"
              : "Save and review"
            : `Next: ${SELL_STEPS[step + 1].toLowerCase()}`;
  const nextDisabled = step === 5 ? !complete || posting || uploading : !canNext[step];

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "Sell an item", headerBackTitle: "Back" }} />
      <View style={styles.progress}>
        <View style={styles.bars}>
          {SELL_STEPS.map((s, i) => (
            <View key={s} style={[styles.bar, i <= step && styles.barOn]} />
          ))}
        </View>
        <Text style={styles.crumbs} numberOfLines={1}>
          {SELL_STEPS.map((s, i) => (
            <Text key={s} style={i < step ? styles.crumbDone : i === step ? styles.crumbOn : styles.crumbTodo}>
              {i > 0 ? "  ·  " : ""}
              {s}
            </Text>
          ))}
        </Text>
      </View>

      <ScrollView ref={scroll} contentContainerStyle={styles.content} {...FORM_SCROLL_KEYBOARD}>
        <Text style={styles.title}>{titles[step]}</Text>
        {body[step]}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {step > 0 ? (
          <Pressable onPress={() => go(step - 1)} hitSlop={8} style={styles.back} accessibilityRole="button" accessibilityLabel="Back a step">
            <Ionicons name="chevron-back" size={20} color={colors.navy900} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => (step === 5 ? void post() : go(step + 1))}
          disabled={nextDisabled}
          style={[styles.next, nextDisabled && styles.nextOff]}
          accessibilityRole="button"
        >
          {posting ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.nextLabel}>{nextLabel}</Text>}
        </Pressable>
      </View>
      <KeyboardDoneButton />
    </View>
  );
}

function ListRow({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.listRow} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[styles.listLabel, on && { color: colors.green700, fontFamily: fonts.bodyBold }]}>{label}</Text>
      {on ? <Ionicons name="checkmark" size={18} color={colors.green700} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  progress: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: spacing.md, paddingTop: 10, paddingBottom: 10, gap: 8 },
  bars: { flexDirection: "row", gap: 4 },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.line },
  barOn: { backgroundColor: colors.green700 },
  crumbs: { fontFamily: fonts.body, fontSize: 12 },
  crumbDone: { color: colors.green700, fontFamily: fonts.bodySemi },
  crumbOn: { color: colors.navy900, fontFamily: fonts.bodyBold },
  crumbTodo: { color: "#9aa3b0" },

  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  title: { fontFamily: fonts.display, fontSize: 25, lineHeight: 30, color: colors.navy900 },
  stepBody: { gap: 12 },
  field: { gap: 8 },
  label: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.navy900 },
  hint: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  link: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.green700 },
  groupLabel: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1, color: colors.ink500, marginTop: 4 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  card: { gap: 8, padding: 12, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },

  // 16pt floor — iOS zooms the screen when a smaller input takes focus.
  input: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  notes: { minHeight: 140, textAlignVertical: "top" },

  typedRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.gold500, backgroundColor: colors.surface },
  typedInput: { flex: 1, minHeight: 46, fontFamily: fonts.body, fontSize: 16, color: colors.ink900 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { width: "31.5%", minHeight: 76, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 4 },
  tileOn: { borderWidth: 2, borderColor: colors.green700, backgroundColor: "#eef5ec" },
  tileLabel: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.ink900, textAlign: "center" },
  tick: { position: "absolute", top: 5, right: 5, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },

  search: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingHorizontal: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.ink900 },
  logoTile: { width: "31.5%", height: 58, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  logoTileOn: { borderWidth: 2, borderColor: colors.green700 },
  logo: { width: "86%", height: 38 },
  logoText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.navy900, textAlign: "center" },
  list: { borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: "hidden" },
  listRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, minHeight: 46, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  listLabel: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink900 },

  modelRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  modelRowOn: { borderWidth: 2, borderColor: colors.green700 },
  modelHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  year: { fontFamily: fonts.bodyBold, fontSize: 11, color: "#8a6a1f", backgroundColor: "#f6ead0", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },
  modelName: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.navy900 },

  condition: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  conditionOn: { borderWidth: 2, borderColor: colors.green700 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: "#c9bfa8" },
  radioOn: { borderWidth: 6, borderColor: colors.green700 },
  conditionName: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },

  priceRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  euro: { fontFamily: fonts.display, fontSize: 26, color: colors.ink900 },
  priceInput: { flex: 1, fontSize: 22, fontFamily: fonts.bodyBold },
  guide: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radii.md, backgroundColor: colors.green100 },
  guideText: { flex: 1, fontFamily: fonts.body, fontSize: 13.5, color: colors.green800 },
  guideBold: { fontFamily: fonts.bodyBold },
  guideUse: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.green700 },
  placeRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  preview: { flexDirection: "row", gap: 12, alignItems: "center", padding: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  previewImage: { width: 76, height: 76, borderRadius: 10 },
  previewCrumb: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 0.6, color: colors.green700 },
  previewTitle: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.ink900 },
  previewPrice: { fontFamily: fonts.display, fontSize: 19, color: colors.navy900 },
  error: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600 },
  footnote: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  footnoteLabel: { flex: 1, fontFamily: fonts.body, fontSize: type.label, color: colors.ink500 },

  footer: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: spacing.md, paddingTop: 12, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line },
  back: { width: 52, height: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  next: { flex: 1, minHeight: 52, borderRadius: 14, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  nextOff: { opacity: 0.45 },
  nextLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: "#fff" },
});

/** Junior members (0159): selling isn't for every age — a deep link gets the panel, not a form the database would refuse. */
export default function NewListingScreen() {
  const gate = useAgeGate("sell");
  if (gate === "loading") return <AgeGateLoading />;
  if (gate === "blocked") return <NotForUnder18 feature="sell" title="Selling" />;
  return <NewListingScreenInner />;
}
