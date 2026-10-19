import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@expo/vector-icons/Ionicons";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";

import { Avatar } from "@/components/avatar";
import { EmojiTray } from "@/components/emoji-tray";
import { MessageActionsSheet, MessageInfoSheet, QuoteBlock, type MessageAction } from "@/components/chat-bits";
import { ApiError, type UploadFile } from "@/lib/api";
import { SharedPostCard } from "@/components/shared-post-card";
import { useAuth } from "@/lib/auth";
import { postIdsInText } from "@/lib/share-links";
import {
  canDeleteForEveryone,
  draftQuote,
  reactionChips,
  reactionsByMessage,
  senderColour,
  tickState,
  typingLine,
} from "@/lib/chat-look";
import {
  MESSAGE_MAX_LENGTH,
  MESSAGE_REPORT_REASONS,
  conversationHeader,
  dayLabel,
  deleteForEveryone,
  deleteForMe,
  getMessage,
  hiddenMessageIds,
  listMessages,
  listReactions,
  localDayKey,
  markRead,
  leaveGroup,
  messageTime,
  reactToMessage,
  reportMessage,
  sendMessage,
  sendPhotoMessage,
  signedImageUrls,
  startPrivateReply,
  type ConversationHeader,
  type Cursor,
  type Message,
  type MessageQuote,
  type Reaction,
  type ThreadMember,
} from "@/lib/messages";
import { subscribeToConversation, subscribeToTyping } from "@/lib/realtime";
import { colors, fonts, headerTitleStyle, radii, spacing, type } from "@/lib/theme";
import { PHOTO_PICKER_OPTIONS, preparePhotoForUpload } from "@/lib/photo-picking";
import { AgeGateLoading, NotForUnder18, useAgeGate } from "@/components/not-for-under-18";
import { ChatAddSheet, EventCard, NextUpStrip, type AddOption } from "@/components/group-chat-bits";
import { groupEventCards, groupForConversation, myPlaceIn, nextUp, type ChatGroup, type GroupEventCard } from "@/lib/group-chat";
import { groupLine, mergeTimeline } from "@/lib/group-chat-rules";
import { officeAreas, isGroupOffice } from "@/lib/groups";
import { irishToday } from "@/lib/outing-rules";

/** A row in the chat: a message, or one of the group's events (0181). */
type Row = { kind: "message"; item: Message } | { kind: "card"; item: GroupEventCard };

/**
 * One conversation — redesigned Oct 2026 with what members expect from
 * WhatsApp: day dividers, grouped bubbles with the time and ✓ / ✓✓ inside,
 * names in colour in a group, "Seán is typing…", and a long-press on any
 * message for reactions, Reply, Reply privately, Copy, Info, Report and
 * Delete. Swipe a message right to reply.
 *
 * The list is inverted, which is the whole trick to a chat screen: newest at
 * index 0 rendered at the bottom, so "scroll to the latest" is the resting
 * position, and loading older messages is an ordinary onEndReached at the
 * top. The data stays newest-first exactly as the query returns it.
 */
function ConversationScreenInner() {
  // `draft`: words to start the box with — "Make offer" on a listing opens the
  // thread with "Would you take €… for …?" ready to finish and send.
  const params = useLocalSearchParams<{ id: string; replyTo?: string; group?: string; draft?: string }>();
  const conversationId = Number(params.id);
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [header, setHeader] = useState<ConversationHeader | null>(null);
  /** The Golf Buddies group or trip this chat belongs to (0181), its events,
   *  and whether you run its events. Null for any other chat. */
  const [chatGroup, setChatGroup] = useState<ChatGroup | null>(null);
  const [events, setEvents] = useState<GroupEventCard[]>([]);
  const [organiser, setOrganiser] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState(typeof params.draft === "string" ? params.draft.slice(0, 500) : "");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  /** Reactions per message id, and the messages I've deleted for myself. */
  const [reactions, setReactions] = useState<Map<number, Reaction[]>>(new Map());
  const [hidden, setHidden] = useState<Set<number>>(new Set());

  /** The message a reply is being written to, with the quote to show. */
  const [replyTo, setReplyTo] = useState<{ id: number; quote: MessageQuote } | null>(null);
  /** The long-pressed message, and the one whose Info is open. */
  const [picked, setPicked] = useState<Message | null>(null);
  const [infoFor, setInfoFor] = useState<Message | null>(null);
  /** Who is typing, until when (ms). */
  const [typing, setTyping] = useState<Map<string, number>>(new Map());
  const [flash, setFlash] = useState<number | null>(null);

  const listRef = useRef<FlatList<Row>>(null);
  const inputRef = useRef<TextInput>(null);
  const typingRef = useRef<{ ping: () => void; stop: () => void } | null>(null);

  /**
   * Signed URLs for the photos in this thread, keyed by storage path.
   * `message-images` is private (0086) and its URLs expire, so a message
   * carries the PATH and the screen asks for a link when it needs one.
   */
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(new Map());
  const signFor = useCallback(async (batch: Message[]) => {
    const needed = batch.filter((m) => m.image_path);
    if (needed.length === 0) return;
    const signed = await signedImageUrls(needed);
    if (signed.size === 0) return;
    setImageUrls((prev) => new Map([...prev, ...signed]));
  }, []);

  const loadReactionsFor = useCallback(async (ids: number[]) => {
    if (ids.length === 0) return;
    const rows = await listReactions(ids).catch(() => null);
    if (!rows) return;
    const grouped = reactionsByMessage(rows);
    setReactions((prev) => {
      const next = new Map(prev);
      for (const id of ids) {
        const list = grouped.get(id);
        if (list) next.set(id, list);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  // Marking read as messages arrive while the thread is open — throttled, so
  // the sender's ✓✓ turns green without a write per line.
  // At most one write per 4 seconds, with a trailing one so the last message
  // of a burst is always marked.
  const lastMark = useRef(0);
  const markTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markSoon = useCallback(() => {
    if (!userId) return;
    const wait = 4000 - (Date.now() - lastMark.current);
    if (wait <= 0) {
      lastMark.current = Date.now();
      void markRead(conversationId, userId);
      return;
    }
    if (markTimer.current) return;
    markTimer.current = setTimeout(() => {
      markTimer.current = null;
      lastMark.current = Date.now();
      void markRead(conversationId, userId);
    }, wait);
  }, [conversationId, userId]);
  useEffect(() => () => {
    if (markTimer.current) clearTimeout(markTimer.current);
  }, []);

  // Guards against the same message arriving twice — once as the reply to our
  // own POST, once over the broadcast channel.
  const add = useCallback(
    (incoming: Message) => {
      setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [incoming, ...prev]));
      void signFor([incoming]);
      if (incoming.sender_id !== userId) {
        markSoon();
        // They sent it, so they've stopped typing.
        setTyping((prev) => {
          if (!prev.has(incoming.sender_id)) return prev;
          const next = new Map(prev);
          next.delete(incoming.sender_id);
          return next;
        });
      }
    },
    [signFor, userId, markSoon]
  );

  const load = useCallback(async () => {
    if (!Number.isInteger(conversationId) || !userId) return;
    try {
      const [head, page, hides] = await Promise.all([
        conversationHeader(conversationId, userId),
        listMessages(conversationId),
        hiddenMessageIds(conversationId).catch(() => new Set<number>()),
      ]);
      setHeader(head);
      setMessages(page.messages);
      setCursor(page.next);
      setHidden(hides);
      setError(null);
      void signFor(page.messages);
      void loadReactionsFor(page.messages.map((m) => m.id));
    } catch {
      setError("Couldn't load this conversation.");
    } finally {
      setLoading(false);
    }
  }, [conversationId, userId, signFor, loadReactionsFor]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The group behind this chat, its events and your part in it (0181). */
  const loadGroup = useCallback(async () => {
    if (!userId) return;
    const g = await groupForConversation(conversationId).catch(() => null);
    setChatGroup(g);
    if (!g) return;
    const [cards, place] = await Promise.all([groupEventCards(g.id, userId), myPlaceIn(g.id, userId).catch(() => null)]);
    setEvents(cards);
    setOrganiser(!!place && officeAreas(place.role, isGroupOffice(place.office) ? place.office : null).includes("events"));
  }, [conversationId, userId]);

  const groupChat = header?.kind === "group";
  useEffect(() => {
    if (groupChat) void loadGroup();
  }, [groupChat, loadGroup]);

  // "Reply privately" lands here with the group message to quote.
  useEffect(() => {
    const id = Number(params.replyTo);
    if (!Number.isInteger(id) || id <= 0) return;
    void getMessage(id).then((m) => {
      if (m) setReplyTo({ id: m.id, quote: draftQuote(m, params.group ?? "a group") });
    });
  }, [params.replyTo, params.group]);

  // Opening a thread is reading it, and so is leaving one you sat in.
  useEffect(() => {
    if (!userId || !Number.isInteger(conversationId)) return;
    void markRead(conversationId, userId);
    return () => {
      void markRead(conversationId, userId);
    };
  }, [conversationId, userId]);

  useEffect(() => {
    if (!Number.isInteger(conversationId)) return;
    return subscribeToConversation(conversationId, {
      onMessage: add,
      onMessageChanged: (messageId, what) => {
        if (what === "reaction") {
          void loadReactionsFor([messageId]);
          return;
        }
        void getMessage(messageId).then((fresh) => {
          if (!fresh) return;
          // The message, and every loaded reply quoting it — its words must
          // not linger in a quote on someone's open screen.
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId ? fresh : m.reply_to_id === messageId ? { ...m, reply_snapshot: { deleted: true } } : m
            )
          );
          setReactions((prev) => {
            const next = new Map(prev);
            next.delete(messageId);
            return next;
          });
        });
      },
      onRead: (memberId, lastReadAt) => {
        setHeader((h) =>
          h ? { ...h, members: h.members.map((m) => (m.id === memberId ? { ...m, lastReadAt } : m)) } : h
        );
      },
    });
  }, [conversationId, add, loadReactionsFor]);

  // Typing: listen, and let go of names after five quiet seconds.
  useEffect(() => {
    if (!Number.isInteger(conversationId) || !userId) return;
    const sub = subscribeToTyping(conversationId, userId, (memberId) => {
      setTyping((prev) => new Map(prev).set(memberId, Date.now() + 5000));
    });
    typingRef.current = sub;
    return () => {
      sub.stop();
      typingRef.current = null;
    };
  }, [conversationId, userId]);

  useEffect(() => {
    if (typing.size === 0) return;
    const t = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const next = new Map([...prev].filter(([, until]) => until > now));
        return next.size === prev.size ? prev : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [typing.size]);

  const loadOlder = useCallback(async () => {
    if (!cursor || loadingOlder || loading) return;
    setLoadingOlder(true);
    try {
      const page = await listMessages(conversationId, cursor);
      setMessages((prev) => [...prev, ...page.messages]);
      setCursor(page.next);
      void signFor(page.messages);
      void loadReactionsFor(page.messages.map((m) => m.id));
    } catch {
      setCursor(null);
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, cursor, loading, loadingOlder, signFor, loadReactionsFor]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const sent = await sendMessage(conversationId, body, replyTo?.id ?? null);
      // Cleared only on success. A message the server refused stays in the
      // box so it can be edited rather than retyped.
      setDraft("");
      setReplyTo(null);
      add(sent);
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : "Couldn't send that message.");
    } finally {
      setSending(false);
    }
  };

  /**
   * Sends a photo, with whatever is in the box as its caption. ONE REQUEST —
   * the server uploads, strips EXIF (GPS) and sends together. The app never
   * touches Storage itself.
   */
  const sendPhoto = async (asset: ImagePicker.ImagePickerAsset) => {
    if (sending) return;
    const file: UploadFile = {
      uri: asset.uri,
      name: asset.fileName ?? `photo-${Date.now()}.jpg`,
      type: asset.mimeType ?? "image/jpeg",
    };
    setSending(true);
    setSendError(null);
    try {
      const caption = draft.trim();
      const ready = await preparePhotoForUpload({ ...file, width: asset.width, height: asset.height });
      const sent = await sendPhotoMessage(conversationId, ready, caption, replyTo?.id ?? null);
      setDraft("");
      setReplyTo(null);
      add(sent);
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : "Couldn't send that photo.");
    } finally {
      setSending(false);
    }
  };

  const capture = async (source: "camera" | "library") => {
    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        source === "camera" ? "Camera is off" : "Photos are off",
        "PinPals needs this to send a photo. You can turn it on in Settings.",
        [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => void Linking.openSettings() },
        ]
      );
      return;
    }
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(PHOTO_PICKER_OPTIONS)
        : await ImagePicker.launchImageLibraryAsync({ ...PHOTO_PICKER_OPTIONS, allowsMultipleSelection: false });
    if (result.canceled || !result.assets[0]) return;
    await sendPhoto(result.assets[0]);
  };

  const pickPhoto = () => {
    setEmojiOpen(false);
    Alert.alert("Send a photo", undefined, [
      { text: "Take a photo", onPress: () => void capture("camera") },
      { text: "Choose from library", onPress: () => void capture("library") },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  /** The tray and the keyboard are alternatives, never both. */
  const toggleEmoji = () => {
    setEmojiOpen((open) => {
      if (!open) Keyboard.dismiss();
      return !open;
    });
  };

  const onDraft = (text: string) => {
    setDraft(text);
    if (text.trim()) typingRef.current?.ping();
  };

  const senders = useMemo(() => new Map((header?.members ?? []).map((m) => [m.id, m])), [header]);
  const nameOf = useCallback((id: string) => senders.get(id)?.name ?? null, [senders]);
  const isGroup = header?.kind === "group";

  const startReply = (m: Message) => {
    setReplyTo({ id: m.id, quote: draftQuote(m) });
    setEmojiOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const react = async (m: Message, emoji: string) => {
    if (!userId) return;
    // Optimistic — the chip appears as the sheet closes; the database is the
    // judge and a refetch puts it right if it disagreed.
    setReactions((prev) => {
      const next = new Map(prev);
      const list = (next.get(m.id) ?? []).filter((r) => r.memberId !== userId);
      const had = (prev.get(m.id) ?? []).find((r) => r.memberId === userId)?.emoji;
      if (had !== emoji) list.push({ messageId: m.id, memberId: userId, emoji });
      if (list.length) next.set(m.id, list);
      else next.delete(m.id);
      return next;
    });
    try {
      await reactToMessage(m.id, emoji);
    } catch (e) {
      void loadReactionsFor([m.id]);
      setSendError(e instanceof Error ? e.message : "Couldn't add that reaction.");
    }
  };

  const replyPrivately = async (m: Message) => {
    try {
      const id = await startPrivateReply(m.id);
      router.push({
        pathname: "/conversation/[id]",
        params: { id: String(id), replyTo: String(m.id), group: header?.otherName ?? "a group" },
      });
    } catch (e) {
      Alert.alert("Couldn't open a chat", e instanceof Error ? e.message : "Please try again.");
    }
  };

  const copy = (m: Message) => {
    // A share sheet rather than a clipboard: the clipboard needs a native
    // module, and the share sheet's first option on iOS is Copy.
    void Share.share({ message: m.body });
  };

  const report = (m: Message) => {
    Alert.alert("Report this message?", "The PinPals team will look at it. They won't tell the sender who reported it.", [
      ...MESSAGE_REPORT_REASONS.map((r) => ({
        text: r.label,
        onPress: () =>
          void reportMessage(m.id, r.category)
            .then(() => Alert.alert("Reported", "Thanks — we'll take a look."))
            .catch((e: unknown) => Alert.alert("Couldn't report that", e instanceof ApiError ? e.message : "Please try again.")),
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  const remove = (m: Message) => {
    const everyone = canDeleteForEveryone(m, userId);
    Alert.alert("Delete message?", everyone ? "Delete it for everyone in this chat, or just from your phone." : undefined, [
      ...(everyone
        ? [
            {
              text: "Delete for everyone",
              style: "destructive" as const,
              onPress: () =>
                void deleteForEveryone(m.id)
                  .then(() => getMessage(m.id))
                  .then((fresh) => {
                    if (fresh) {
                      setMessages((prev) =>
                        prev.map((x) =>
                          x.id === m.id ? fresh : x.reply_to_id === m.id ? { ...x, reply_snapshot: { deleted: true } } : x
                        )
                      );
                    }
                  })
                  .catch((e: unknown) => Alert.alert("Couldn't delete that", e instanceof ApiError ? e.message : "Please try again.")),
            },
          ]
        : []),
      {
        text: "Delete for me",
        style: "destructive" as const,
        onPress: () => {
          setHidden((prev) => new Set(prev).add(m.id));
          void deleteForMe(m.id).catch(() =>
            setHidden((prev) => {
              const next = new Set(prev);
              next.delete(m.id);
              return next;
            })
          );
        },
      },
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  const actionsFor = (m: Message): MessageAction[] => {
    const mine = m.sender_id === userId;
    const live = !m.hidden_at && !m.deleted_at;
    const out: MessageAction[] = [];
    if (live) out.push({ key: "reply", label: "Reply", icon: "arrow-undo-outline", onPress: () => startReply(m) });
    if (live && isGroup && !mine) {
      out.push({ key: "private", label: "Reply privately", icon: "chatbubble-ellipses-outline", onPress: () => void replyPrivately(m) });
    }
    if (live && m.body.trim()) out.push({ key: "copy", label: "Copy", icon: "copy-outline", onPress: () => copy(m) });
    if (mine && live) out.push({ key: "info", label: "Info", icon: "information-circle-outline", onPress: () => setInfoFor(m) });
    if (!mine && live) out.push({ key: "report", label: "Report", icon: "flag-outline", destructive: true, onPress: () => report(m) });
    out.push({ key: "delete", label: "Delete", icon: "trash-outline", destructive: true, onPress: () => remove(m) });
    return out;
  };

  const jumpTo = (messageId: number) => {
    const index = rows.findIndex((r) => r.kind === "message" && r.item.id === messageId);
    if (index < 0) return;
    listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    setFlash(messageId);
    setTimeout(() => setFlash((f) => (f === messageId ? null : f)), 1400);
  };

  const confirmLeave = () => {
    Alert.alert(
      `Leave ${header?.otherName ?? "this group"}?`,
      "You'll stop receiving messages and won't be able to read the conversation again. Whoever started it can add you back.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () => {
            void (async () => {
              if (!userId) return;
              const ok = await leaveGroup(conversationId, userId);
              if (ok) router.replace("/inbox");
              else setSendError("Couldn't leave that group — please try again.");
            })();
          },
        },
      ]
    );
  };

  const visible = useMemo(() => messages.filter((m) => !hidden.has(m.id)), [messages, hidden]);
  // The group's events among the messages, newest first like the list (0181).
  const rows = useMemo<Row[]>(() => mergeTimeline(visible, chatGroup ? events : [], !!cursor), [visible, chatGroup, events, cursor]);
  const indexOf = useMemo(() => new Map(visible.map((m, i) => [m.id, i] as const)), [visible]);
  const today = irishToday();
  const pinned = chatGroup ? nextUp(events, today) : null;
  const typingNames = [...typing.keys()].map((id) => nameOf(id) ?? "Someone");
  const typingText = typingLine(typingNames);
  const over = draft.trim().length > MESSAGE_MAX_LENGTH;
  const canSend = !!draft.trim() && !sending && !over;
  const pickedReaction = picked && userId ? ((reactions.get(picked.id) ?? []).find((r) => r.memberId === userId)?.emoji ?? null) : null;

  const subtitle = typingText ?? (chatGroup ? groupLine(chatGroup, today) : isGroup ? `${header?.members.length ?? 0} members` : null);

  const openGroup = () => {
    if (chatGroup) router.push({ pathname: "/group/[id]", params: { id: String(chatGroup.id) } });
  };

  /** The + sheet: a photo for everyone; events for whoever runs them. */
  const addOptions: AddOption[] = chatGroup
    ? [
        { key: "photo", label: "Photo", icon: "image-outline", onPress: pickPhoto },
        { key: "events", label: chatGroup.kind === "trip" ? "Trip events" : "Rounds & events", icon: "calendar-outline", onPress: () => router.push({ pathname: "/group/[id]/events", params: { id: String(chatGroup.id) } }) },
        ...(pinned
          ? [{ key: "next", label: pinned.outingKind === "day" ? "Next round" : "Itinerary", icon: (pinned.outingKind === "day" ? "flag-outline" : "map-outline") as AddOption["icon"], onPress: () =>
              pinned.outingKind === "day"
                ? router.push({ pathname: "/group/[id]/outing/[outingId]", params: { id: String(chatGroup.id), outingId: String(pinned.id) } })
                : router.push({ pathname: "/group/[id]/itinerary/[outingId]", params: { id: String(chatGroup.id), outingId: String(pinned.id) } }) }]
          : []),
        ...(organiser
          ? [
              { key: "new", label: chatGroup.kind === "trip" ? "Plan a trip day" : "Post a round", icon: "add-circle-outline" as const, organiser: true, onPress: () => router.push({ pathname: "/group/[id]/outing/new", params: { id: String(chatGroup.id) } }) },
              ...(pinned
                ? [{ key: "pay", label: "Ask for money", icon: "cash-outline" as const, organiser: true, onPress: () => router.push({ pathname: "/group/[id]/outing/[outingId]", params: { id: String(chatGroup.id), outingId: String(pinned.id) } }) }]
                : []),
            ]
          : []),
      ]
    : [];

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
    >
      <Stack.Screen
        options={{
          headerBackTitle: "Back",
          headerStyle: { backgroundColor: colors.navy900 },
          headerTintColor: colors.cream50,
          headerShadowVisible: false,
          headerTitle: () => (
            <Pressable
              style={styles.headTitle}
              onPress={openGroup}
              disabled={!chatGroup}
              accessibilityRole={chatGroup ? "button" : undefined}
              accessibilityLabel={chatGroup ? `${chatGroup.name}. Open the group's page` : undefined}
            >
              {isGroup ? (
                <View style={[styles.headGroup, chatGroup?.kind === "crew" && styles.headCrew, chatGroup?.kind === "trip" && styles.headTrip]}>
                  <Ionicons
                    name={chatGroup?.kind === "trip" ? "airplane" : "people"}
                    size={17}
                    color={chatGroup?.kind === "trip" ? colors.gold400 : chatGroup?.kind === "crew" ? colors.cream50 : colors.navy900}
                  />
                </View>
              ) : (
                <Avatar url={header?.otherAvatarUrl} color={header?.otherAvatarColor} name={header?.otherName} size={34} />
              )}
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.headName} numberOfLines={1} accessibilityRole="header">
                  {header?.otherName ?? "Message"}
                </Text>
                {subtitle ? (
                  <Text style={[styles.headSub, typingText ? styles.headTyping : null, chatGroup && !typingText ? styles.headCaps : null]} numberOfLines={1}>
                    {chatGroup && !typingText ? subtitle.toUpperCase() : subtitle}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ),
          // Chat settings — alerts, who's in it, what's been shared (0181).
          headerRight: isGroup
            ? () => (
                <Pressable
                  onPress={() => router.push({ pathname: "/chat-settings/[id]", params: { id: String(conversationId) } })}
                  hitSlop={8}
                  style={styles.headMore}
                  accessibilityRole="button"
                  accessibilityLabel="Chat settings"
                >
                  <Ionicons name="ellipsis-horizontal" size={22} color={colors.cream50} />
                </Pressable>
              )
            : undefined,
        }}
      />

      {/* A group's chat (0181): its next event pinned under the bar. Leaving
          is the group's business, in chat settings. */}
      {chatGroup && pinned ? <NextUpStrip event={pinned} onChanged={() => void loadGroup()} /> : null}

      {isGroup && header && !chatGroup ? (
        <View style={styles.groupBar}>
          <Text style={styles.groupBarLabel} numberOfLines={1}>
            {header.members.map((m) => (m.id === userId ? "You" : m.name.split(" ")[0])).join(", ")}
          </Text>
          <Pressable onPress={confirmLeave} hitSlop={8} accessibilityRole="button" accessibilityLabel="Leave this group">
            <Text style={styles.leave}>Leave</Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.green700} />
        </View>
      ) : (
        <>
          {header?.listingTitle && header.listingId ? (
            // The item, pinned (approved mock-up 6): photo, price, whether it's
            // still for sale, and for the seller, Mark sold right here.
            <Pressable
              style={styles.context}
              onPress={() => router.push(`/listing/${header.listingId}`)}
              accessibilityRole="button"
              accessibilityLabel={`${header.listingTitle}. Open the listing`}
            >
              {header.listingImageUrl ? (
                <Image source={{ uri: header.listingImageUrl }} style={styles.contextPhoto} />
              ) : (
                <View style={[styles.contextPhoto, styles.contextPhotoNone]}>
                  <Ionicons name="pricetag" size={18} color={colors.green700} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.contextLabel} numberOfLines={1}>
                  {header.listingTitle}
                </Text>
                <Text style={styles.contextMeta} numberOfLines={1}>
                  {header.listingPriceCents != null ? <Text style={styles.contextPrice}>€{Math.round(header.listingPriceCents / 100)}</Text> : null}
                  {header.listingPriceCents != null ? " · " : ""}
                  {header.listingStatus === "active" ? "Available" : header.listingStatus === "reserved" ? "Reserved" : header.listingStatus === "sold" ? "Sold" : "Not on sale"}
                </Text>
              </View>
              {header.listingIsMine && (header.listingStatus === "active" || header.listingStatus === "reserved") ? (
                <Pressable
                  onPress={() => router.push(`/mark-sold/${header.listingId}`)}
                  style={styles.contextAction}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Mark this listing sold"
                >
                  <Text style={styles.contextActionText}>Mark sold</Text>
                </Pressable>
              ) : (
                <Ionicons name="chevron-forward" size={16} color={colors.ink500} />
              )}
            </Pressable>
          ) : null}

          <FlatList
            ref={listRef}
            inverted
            contentContainerStyle={styles.list}
            data={rows}
            keyExtractor={(row) => (row.kind === "card" ? row.item.key : String(row.item.id))}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onEndReached={() => void loadOlder()}
            onEndReachedThreshold={0.4}
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
            }}
            ListHeaderComponent={
              typingText ? (
                <View style={styles.typingRow}>
                  <View style={styles.typingBubble}>
                    <Text style={styles.typingDots}>•••</Text>
                  </View>
                  <Text style={styles.typingLabel}>{typingText}</Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <View style={styles.emptyIcon}>
                  <Ionicons name={error ? "cloud-offline-outline" : "chatbubbles-outline"} size={30} color={colors.green700} />
                </View>
                <Text style={styles.emptyTitle}>{error ?? "No messages yet"}</Text>
                <Text style={styles.emptyBody}>
                  {error
                    ? "Go back and try again."
                    : chatGroup
                      ? `Everyone in ${chatGroup.name} is in this chat, and anyone who joins later sees it all. Say hello.`
                      : "Say hello — long-press any message later for reactions and replies."}
                </Text>
              </View>
            }
            ListFooterComponent={loadingOlder ? <ActivityIndicator color={colors.green700} style={styles.older} /> : null}
            renderItem={({ item: row }) => {
              if (row.kind === "card") {
                return <EventCard event={row.item} members={header?.members ?? []} nameOf={nameOf} meId={userId} today={today} onChanged={() => void loadGroup()} />;
              }
              const item = row.item;
              const index = indexOf.get(item.id) ?? 0;
              // Inverted: index + 1 is the message before this one in time.
              const older = visible[index + 1];
              const newer = visible[index - 1];
              const day = localDayKey(item.created_at);
              const newDay = !older || localDayKey(older.created_at) !== day;
              const firstOfRun = newDay || older.sender_id !== item.sender_id;
              const lastOfRun = !newer || newer.sender_id !== item.sender_id || localDayKey(newer.created_at) !== day;
              const mine = item.sender_id === userId;
              return (
                <>
                  {newDay ? (
                    <View style={styles.dayWrap}>
                      <Text style={styles.day}>{dayLabel(item.created_at)}</Text>
                    </View>
                  ) : null}
                  <SwipeToReply enabled={!item.hidden_at && !item.deleted_at} onReply={() => startReply(item)}>
                    <Bubble
                      message={item}
                      mine={mine}
                      viewerId={userId}
                      imageUrl={item.image_path ? (imageUrls.get(item.image_path) ?? null) : null}
                      sender={senders.get(item.sender_id) ?? null}
                      group={isGroup}
                      firstOfRun={firstOfRun}
                      lastOfRun={lastOfRun}
                      ticks={mine && header ? tickState(item, header.members) : null}
                      chips={reactionChips(reactions.get(item.id) ?? [], userId)}
                      flash={flash === item.id}
                      nameOf={nameOf}
                      onLongPress={() => {
                        Keyboard.dismiss();
                        setPicked(item);
                      }}
                      onChipPress={(emoji) => void react(item, emoji)}
                      onQuotePress={item.reply_to_id ? () => jumpTo(item.reply_to_id!) : undefined}
                    />
                  </SwipeToReply>
                </>
              );
            }}
          />

          <View style={styles.composer}>
            {sendError ? <Text style={styles.sendError}>{sendError}</Text> : null}

            {replyTo ? (
              <View style={styles.replyBar}>
                <View style={{ flex: 1 }}>
                  <QuoteBlock quote={replyTo.quote} me={userId} nameOf={nameOf} colourOf={senderColour} />
                </View>
                <Pressable onPress={() => setReplyTo(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel reply">
                  <Ionicons name="close-circle" size={24} color={colors.ink500} />
                </Pressable>
              </View>
            ) : null}

            <View style={styles.composerRow}>
              {chatGroup ? (
                <Pressable
                  onPress={() => {
                    Keyboard.dismiss();
                    setEmojiOpen(false);
                    setAddOpen(true);
                  }}
                  style={styles.plus}
                  accessibilityRole="button"
                  accessibilityLabel="Add a photo, a round or an event"
                >
                  <Ionicons name="add" size={24} color={colors.navy900} />
                </Pressable>
              ) : null}
              <View style={styles.inputPill}>
                <Pressable
                  onPress={toggleEmoji}
                  style={styles.tool}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: emojiOpen }}
                  accessibilityLabel={emojiOpen ? "Hide emoji" : "Add an emoji"}
                >
                  <Ionicons name={emojiOpen ? "happy" : "happy-outline"} size={24} color={colors.ink500} />
                </Pressable>
                <TextInput
                  ref={inputRef}
                  style={styles.input}
                  value={draft}
                  onChangeText={onDraft}
                  onFocus={() => setEmojiOpen(false)}
                  placeholder={replyTo ? "Write a reply" : "Message"}
                  placeholderTextColor={colors.ink500}
                  multiline
                  maxLength={MESSAGE_MAX_LENGTH + 200}
                  accessibilityLabel="Message"
                />
                <Pressable
                  onPress={pickPhoto}
                  disabled={sending}
                  style={styles.tool}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Send a photo"
                >
                  <Ionicons name="camera-outline" size={24} color={sending ? colors.line : colors.ink500} />
                </Pressable>
              </View>
              <Pressable
                onPress={() => void send()}
                disabled={!canSend}
                style={[styles.send, !canSend && styles.sendOff]}
                accessibilityRole="button"
                accessibilityLabel="Send"
              >
                {sending ? (
                  <ActivityIndicator size="small" color={colors.cream50} />
                ) : (
                  <Ionicons name="send" size={18} color={colors.cream50} style={{ marginLeft: 2 }} />
                )}
              </Pressable>
            </View>

            {over ? (
              <Text style={styles.sendError}>
                That&apos;s longer than {MESSAGE_MAX_LENGTH.toLocaleString("en-IE")} characters.
              </Text>
            ) : null}
          </View>

          {emojiOpen ? <EmojiTray onPick={(emoji) => setDraft((text) => text + emoji)} /> : null}
        </>
      )}

      <MessageActionsSheet
        message={picked}
        mine={picked?.sender_id === userId}
        myReaction={pickedReaction}
        canReact={!!picked && !picked.hidden_at && !picked.deleted_at}
        preview={
          picked
            ? picked.hidden_at
              ? "This message was removed."
              : picked.deleted_at
                ? "This message was deleted"
                : picked.body.trim() || (picked.image_path ? "📷 Photo" : "")
            : ""
        }
        actions={picked ? actionsFor(picked) : []}
        onReact={(emoji) => {
          if (picked) void react(picked, emoji);
        }}
        onClose={() => setPicked(null)}
      />
      <MessageInfoSheet message={infoFor} members={header?.members ?? []} onClose={() => setInfoFor(null)} />
      <ChatAddSheet open={addOpen} options={addOptions} onClose={() => setAddOpen(false)} />
    </KeyboardAvoidingView>
  );
}

/** Swipe a message to the right to reply, as in WhatsApp. */
function SwipeToReply({ enabled, onReply, children }: { enabled: boolean; onReply: () => void; children: React.ReactNode }) {
  const ref = useRef<SwipeableMethods>(null);
  if (!enabled) return <>{children}</>;
  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2.2}
      leftThreshold={56}
      overshootLeft={false}
      dragOffsetFromLeftEdge={18}
      renderLeftActions={() => (
        <View style={styles.swipeReply}>
          <View style={styles.swipeReplyIcon}>
            <Ionicons name="arrow-undo" size={16} color={colors.green700} />
          </View>
        </View>
      )}
      onSwipeableWillOpen={() => {
        onReply();
        ref.current?.close();
      }}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

function Bubble({
  message,
  mine,
  imageUrl,
  sender,
  group,
  firstOfRun,
  lastOfRun,
  viewerId,
  ticks,
  chips,
  flash,
  nameOf,
  onLongPress,
  onChipPress,
  onQuotePress,
}: {
  message: Message;
  mine: boolean;
  viewerId: string | null;
  imageUrl: string | null;
  /** Null for someone who has since left the group — their messages stay. */
  sender: ThreadMember | null;
  group: boolean;
  firstOfRun: boolean;
  lastOfRun: boolean;
  ticks: "sent" | "seen" | null;
  chips: { emoji: string; count: number; mine: boolean }[];
  flash: boolean;
  nameOf: (id: string) => string | null;
  onLongPress: () => void;
  onChipPress: (emoji: string) => void;
  onQuotePress?: () => void;
}) {
  const sharedPostId = message.body && !message.deleted_at ? (postIdsInText(message.body)[0] ?? null) : null;
  const shownBody = sharedPostId
    ? message.body.replace(/https?:\/\/(?:www\.)?pinpals\.ie\/(?:feed\/\d+|s\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g, "").trim()
    : message.body;
  const name = sender?.name ?? null;
  const showAvatarSlot = group && !mine;
  const time = messageTime(message.created_at);

  const rowStyle = [styles.bubbleRow, mine && styles.bubbleRowMine, firstOfRun ? styles.runStart : null];
  const corner = mine
    ? { borderTopRightRadius: firstOfRun ? 18 : 6, borderBottomRightRadius: lastOfRun ? 4 : 6 }
    : { borderTopLeftRadius: firstOfRun ? 18 : 6, borderBottomLeftRadius: lastOfRun ? 4 : 6 };

  // Removed by a moderator, or deleted by whoever sent it: the row stays — a
  // thread that silently loses a line reads as a bug.
  if (message.hidden_at || message.deleted_at) {
    return (
      <View style={rowStyle}>
        {showAvatarSlot ? <View style={styles.avatarSlot} /> : null}
        <Pressable onLongPress={onLongPress} delayLongPress={300} style={[styles.bubble, styles.gone, corner]}>
          <Ionicons name="ban-outline" size={14} color={colors.ink500} />
          <Text style={styles.goneLabel}>
            {message.hidden_at ? "This message was removed" : mine ? "You deleted this message" : "This message was deleted"}
          </Text>
          <Text style={styles.metaGone}>{time}</Text>
        </Pressable>
      </View>
    );
  }

  const colour = sender ? senderColour(sender.id) : colors.ink500;

  return (
    <View style={rowStyle}>
      {showAvatarSlot ? (
        <View style={styles.avatarSlot}>
          {lastOfRun ? <Avatar url={sender?.avatarUrl ?? null} color={sender?.avatarColor ?? null} name={name} size={28} /> : null}
        </View>
      ) : null}

      <View style={[styles.bubbleCol, mine && styles.bubbleColMine]}>
        <Pressable
          onLongPress={onLongPress}
          delayLongPress={300}
          style={({ pressed }) => [
            styles.bubble,
            mine ? styles.mine : styles.theirs,
            corner,
            message.image_path ? styles.bubblePhoto : null,
            sharedPostId ? styles.roomForMeta : null,
            (pressed || flash) && (mine ? styles.minePressed : styles.theirsPressed),
          ]}
          accessibilityHint="Long-press for reactions, reply and more"
        >
          {group && !mine && firstOfRun ? (
            <Text style={[styles.senderName, { color: colour }, message.image_path ? styles.pad : null]} numberOfLines={1}>
              {name ?? "A member"}
            </Text>
          ) : null}

          {message.reply_snapshot ? (
            <View style={message.image_path ? styles.pad : styles.quoteGap}>
              <QuoteBlock
                quote={message.reply_snapshot}
                me={viewerId}
                nameOf={nameOf}
                colourOf={senderColour}
                onMine={mine}
                onPress={message.reply_snapshot.group ? undefined : onQuotePress}
              />
            </View>
          ) : null}

          {message.image_path ? (
            imageUrl ? (
              <Image source={{ uri: imageUrl }} style={styles.photo} resizeMode="contain" accessibilityLabel="Photo" />
            ) : (
              <View style={[styles.photo, styles.photoWaiting]}>
                <Ionicons name="image-outline" size={26} color={colors.ink500} />
              </View>
            )
          ) : null}

          {shownBody ? (
            <Text style={[styles.body, mine && styles.bodyMine, message.image_path ? styles.padCaption : null]}>
              {shownBody}
              {/* Room for the time, so it never sits on top of the last word. */}
              <Text style={styles.metaSpacer}>{"  " + time + (ticks ? "    " : "")}</Text>
            </Text>
          ) : null}

          {sharedPostId && viewerId ? <SharedPostCard postId={sharedPostId} viewerId={viewerId} mine={mine} /> : null}

          <View style={[styles.meta, message.image_path && !shownBody ? styles.metaOnPhoto : null]}>
            <Text style={[styles.metaTime, mine && styles.metaTimeMine, message.image_path && !shownBody ? styles.metaOnPhotoText : null]}>
              {time}
            </Text>
            {ticks ? (
              <Ionicons
                name={ticks === "seen" ? "checkmark-done" : "checkmark"}
                size={15}
                color={ticks === "seen" ? colors.gold400 : "rgba(247,243,234,0.7)"}
                accessibilityLabel={ticks === "seen" ? "Read" : "Sent"}
              />
            ) : null}
          </View>
        </Pressable>

        {chips.length ? (
          <View style={[styles.chips, mine ? styles.chipsMine : null]}>
            {chips.map((c) => (
              <Pressable
                key={c.emoji}
                onPress={() => onChipPress(c.emoji)}
                style={[styles.chip, c.mine && styles.chipMine]}
                accessibilityRole="button"
                accessibilityLabel={`${c.emoji} ${c.count}${c.mine ? ", including you. Tap to remove yours" : ". Tap to add"}`}
              >
                <Text style={styles.chipEmoji}>{c.emoji}</Text>
                {c.count > 1 ? <Text style={styles.chipCount}>{c.count}</Text> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#f3eee2" },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },

  headTitle: { flexDirection: "row", alignItems: "center", gap: 10, maxWidth: 260 },
  headGroup: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  headName: { ...headerTitleStyle, color: colors.cream50 },
  headSub: { fontFamily: fonts.body, fontSize: 12.5, color: "rgba(247,243,234,0.7)" },
  headTyping: { color: colors.gold400, fontFamily: fonts.bodySemi },
  // A group's chat (0181): its kind's colours, and the gold caps line under the name.
  headCrew: { borderRadius: 10, backgroundColor: colors.green700, borderWidth: 1.5, borderColor: colors.gold400 },
  headTrip: { borderRadius: 10, backgroundColor: colors.navy800, borderWidth: 1.5, borderColor: colors.gold400 },
  headCaps: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1.3, color: colors.gold400 },
  headMore: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },

  groupBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    backgroundColor: colors.navy800,
  },
  groupBarLabel: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: "rgba(247,243,234,0.8)" },
  leave: { fontFamily: fonts.bodyBold, fontSize: 13, color: "#f2b3a8" },

  context: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  contextLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
  contextMeta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, marginTop: 1 },
  contextPrice: { fontFamily: fonts.display, fontSize: 14, color: colors.navy900 },
  contextPhoto: { width: 44, height: 44, borderRadius: 10 },
  contextPhotoNone: { backgroundColor: colors.green100, alignItems: "center", justifyContent: "center" },
  contextAction: { minHeight: 34, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.navy900, justifyContent: "center" },
  contextActionText: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.cream50 },

  list: { paddingHorizontal: 12, paddingVertical: spacing.sm, flexGrow: 1 },
  older: { paddingVertical: spacing.md },

  dayWrap: { alignItems: "center", paddingVertical: 10 },
  day: {
    fontFamily: fonts.bodySemi,
    fontSize: 12.5,
    color: colors.ink500,
    backgroundColor: "rgba(255,255,255,0.85)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radii.pill,
    overflow: "hidden",
  },

  bubbleRow: { flexDirection: "row", alignItems: "flex-end", gap: 6, marginTop: 2, maxWidth: "86%" },
  bubbleRowMine: { alignSelf: "flex-end", justifyContent: "flex-end" },
  runStart: { marginTop: 8 },
  avatarSlot: { width: 28 },
  bubbleCol: { flexShrink: 1, alignItems: "flex-start" },
  bubbleColMine: { alignItems: "flex-end" },

  bubble: {
    paddingHorizontal: 12,
    paddingTop: 7,
    paddingBottom: 7,
    borderRadius: 18,
    shadowColor: "#0c2038",
    shadowOpacity: 0.06,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  theirs: { backgroundColor: colors.surface },
  theirsPressed: { backgroundColor: "#ebe5d6" },
  mine: { backgroundColor: colors.green700 },
  minePressed: { backgroundColor: colors.green800 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 22, color: colors.ink900 },
  bodyMine: { color: colors.cream50 },
  senderName: { fontFamily: fonts.bodyBold, fontSize: 13.5, marginBottom: 2 },
  quoteGap: { marginBottom: 5, minWidth: 160 },
  pad: { paddingHorizontal: 12, paddingTop: 6 },
  padCaption: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 7 },
  roomForMeta: { paddingBottom: 22 },

  // An invisible copy of the time at the end of the text keeps the last line
  // clear of the real one, which sits in the bubble's bottom-right corner.
  metaSpacer: { fontSize: 11.5, color: "transparent" },
  meta: { position: "absolute", right: 10, bottom: 5, flexDirection: "row", alignItems: "center", gap: 3 },
  metaTime: { fontFamily: fonts.body, fontSize: 11.5, color: colors.ink500 },
  metaTimeMine: { color: "rgba(247,243,234,0.75)" },
  metaOnPhoto: { backgroundColor: "rgba(12,32,56,0.55)", borderRadius: radii.pill, paddingHorizontal: 7, paddingVertical: 2 },
  metaOnPhotoText: { color: colors.cream50 },

  bubblePhoto: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0, overflow: "hidden", minWidth: 232 },
  photo: { width: 240, aspectRatio: 4 / 3, backgroundColor: colors.surfaceTint },
  photoWaiting: { alignItems: "center", justifyContent: "center" },

  gone: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.6)", borderWidth: 1, borderColor: colors.line, shadowOpacity: 0 },
  goneLabel: { fontFamily: fonts.body, fontSize: type.small, fontStyle: "italic", color: colors.ink500 },
  metaGone: { fontFamily: fonts.body, fontSize: 11, color: colors.ink500, marginLeft: 4 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: -4, marginLeft: 8 },
  chipsMine: { marginLeft: 0, marginRight: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: "#f3eee2",
  },
  chipMine: { backgroundColor: colors.green100 },
  chipEmoji: { fontSize: 15 },
  chipCount: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.ink900 },

  swipeReply: { width: 52, alignItems: "center", justifyContent: "center" },
  swipeReplyIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },

  typingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8, paddingLeft: 4 },
  typingBubble: { backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  typingDots: { fontSize: 16, letterSpacing: 2, color: colors.ink500 },
  typingLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },

  composer: {
    gap: 6,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: spacing.md,
    backgroundColor: "#f3eee2",
  },
  replyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  plus: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  inputPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: colors.surface,
    paddingHorizontal: 4,
    shadowColor: "#0c2038",
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  tool: { width: 40, height: 46, alignItems: "center", justifyContent: "center" },
  // 16pt floor — iOS zooms the screen when a smaller input takes focus.
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 132,
    paddingTop: 12,
    paddingBottom: 12,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
  },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: colors.green700 },
  sendOff: { backgroundColor: colors.ink500, opacity: 0.35 },
  sendError: { fontFamily: fonts.body, fontSize: type.small, color: colors.red600, paddingHorizontal: 6 },

  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    // The list is inverted, so its children are too.
    transform: [{ scaleY: -1 }],
  },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.green100, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink900, textAlign: "center" },
  emptyBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center", maxWidth: 280 },
});

/** Junior members (0159): messages aren't for every age — a deep link gets the panel, not a form the database would refuse. */
export default function ConversationScreen() {
  const gate = useAgeGate("chat");
  if (gate === "loading") return <AgeGateLoading />;
  if (gate === "blocked") return <NotForUnder18 feature="chat" title="Messages" />;
  return <ConversationScreenInner />;
}
