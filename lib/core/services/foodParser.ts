/// Wire contracts for the food parser — must match the backend `server/src/types.ts`.
///
/// THE HONESTY RULE: per-100g composition is EXACT (from the nutrition DB); the
/// whole-dish total is APPROXIMATE while the weight is only estimated. The model
/// never emits nutrition numbers — every number here comes from the DB resolver.

export type Region = 'RU' | 'US';

/// Where a per-100g number came from. `estimate` = DB miss (coarse, not fact).
/// Where a per-100g block came from. `estimate` = a full DB miss (the client
/// shows NO fabricated numbers for it); `manual` = the user typed the macros in;
/// `history` = re-logged from the user's own earlier entry (real, their data).
export type NutritionSource =
  | 'usda'
  | 'skurikhin'
  | 'openfoodfacts'
  | 'apininjas'
  | 'fatsecret'
  | 'estimate'
  | 'manual'
  | 'history';

/// Mineral set v1 — mg per 100 g (or scaled). Any subset may be present.
export interface Minerals {
  na?: number;
  k?: number;
  ca?: number;
  mg?: number;
  fe?: number;
  zn?: number;
}

/// Macros + minerals for a fixed quantity (per-100g or scaled).
export interface NutrientValues {
  kcal: number;
  prot: number;
  fat: number;
  carb: number;
  // Extended-label fields (grams). Present ONLY when the source provides the
  // field — never zero-filled, so a 0 is always a real zero, not missing data.
  fiber?: number;
  sugar?: number;
  satFat?: number;
  minerals: Minerals;
}

/// EXACT per-100g composition from the nutrition DB (or a coarse `estimate`).
export interface Per100 extends NutrientValues {
  source: NutritionSource;
}

/// A runner-up DB match the user can switch to when the primary is wrong.
export interface NutritionAlternative {
  name: string;
  per100: Per100; // EXACT composition (carries its own source label)
}

/// One resolved component — exact per-100g + the scaled-to-grams total.
export interface NutritionItem {
  name_ru: string;
  name_en: string;
  grams: number;
  grams_source: 'estimated' | 'confirmed';
  confidence: number; // 0..1
  per100: Per100; // EXACT (or estimate on a DB miss); may be cook-method-adjusted
  scaled: NutrientValues; // per100 * grams / 100
  approximate: boolean; // true while grams_source === 'estimated' OR cook-adjusted
  // Cooking-method branch (client-side, offline). `cook_method` is the chosen
  // method ('raw' = DB baseline); `basePer100` preserves the unadjusted DB row so
  // switching methods is reversible. Both absent until the user picks a method.
  cook_method?: import('../insights/cookMethod').CookMethod;
  basePer100?: Per100;
  // The component is an already-prepared dish consumed as-is (soup, salad,
  // ready meal) — set server-side from the curated-table flag or the LLM
  // signal. Its per-100g baseline already describes the FINISHED dish, so the
  // cooking-method chips are hidden for it (an adjustment would double-count).
  prepared?: boolean;
  // Other ranked DB matches for the same item (best-first), surfaced behind
  // "не то?" so the user can correct a wrong pick without retyping.
  alternatives?: NutritionAlternative[];
  // Client-only: the user explicitly picked this match (an alternative, a manual
  // search result, or a remembered choice). Drives "remember my choice" on save.
  userChosen?: boolean;
}

/// A parsed meal awaiting the user's grams confirmation, then saved.
export interface MealDraft {
  region: Region;
  items: NutritionItem[];
  totals: NutrientValues;
  portion_state: 'estimated' | 'confirmed';
  approximate: boolean; // true if any item is still estimated
  flags: {
    has_estimate: boolean; // a per100 came from the estimate fallback (DB miss)
    low_confidence: boolean; // an item is below the confidence floor
    // Set CLIENT-side (never by the server): the online parser failed and the
    // offline stub answered instead — the UI must say so, not pass degraded
    // numbers off as an AI parse.
    offline_fallback?: boolean;
  };
}

/// A prepared photo ready for upload — already downscaled + EXIF-stripped.
export interface PhotoInput {
  uri: string;
  mimeType: string;
}

/// A recorded voice clip ready for upload (e.g. m4a from expo-audio).
export interface AudioInput {
  uri: string;
  mimeType: string;
}

/// Turns a free-form food description (text, a photo, or a voice clip) into a
/// structured, honest [MealDraft].
///
/// Online (HttpFoodParser) it calls the food-parse backend — the app's ONLY
/// external network call. Offline it falls back to a deterministic local stub
/// (text), or an empty draft for photo/voice (no on-device vision or speech).
export interface FoodParser {
  parse(text: string, region: Region): Promise<MealDraft>;
  parsePhoto(photo: PhotoInput, region: Region): Promise<MealDraft>;
  parseAudio(audio: AudioInput, region: Region): Promise<MealDraft>;
  /// Free-text DB search for the manual "find it yourself" picker — ranked
  /// candidates the user can swap an item to. Online it queries the backend;
  /// offline it returns an empty list (no on-device nutrition DB).
  searchFoods(query: string, region: Region): Promise<NutritionAlternative[]>;
}
