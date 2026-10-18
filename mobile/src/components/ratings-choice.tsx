import { useEffect, useState } from "react";
import { Text } from "react-native";

import { Chip, ChipGroup } from "@/components/form-bits";
import { RATINGS_CHOICES, loadMyRatingsCategory, saveMyRatingsCategory, type RatingsCategory } from "@/lib/ratings-category";
import { colors, fonts } from "@/lib/theme";

/**
 * "Which course ratings do you play off?" — Men's, Women's, Prefer not to
 * say (0177). Saves as soon as it's tapped; tap the chosen one again to clear it.
 */
export function RatingsChoice({ userId }: { userId: string }) {
  const [value, setValue] = useState<RatingsCategory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadMyRatingsCategory(userId).then((v) => live && setValue(v));
    return () => {
      live = false;
    };
  }, [userId]);

  const pick = async (v: RatingsCategory) => {
    const next = value === v ? null : v;
    const before = value;
    setValue(next);
    setError(null);
    try {
      await saveMyRatingsCategory(userId, next);
    } catch (e) {
      setValue(before);
      setError(e instanceof Error ? e.message : "Couldn't save that.");
    }
  };

  return (
    <>
      <ChipGroup>
        {RATINGS_CHOICES.map((c) => (
          <Chip key={c.value} label={c.label} selected={value === c.value} onPress={() => void pick(c.value)} />
        ))}
      </ChipGroup>
      {error ? <Text style={{ fontFamily: fonts.bodySemi, fontSize: 13, color: colors.red600 }}>{error}</Text> : null}
    </>
  );
}
