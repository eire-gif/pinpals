// Plain data the review form (a client component) needs. Kept apart from
// src/lib/course-reviews.ts, which is server-only. The tag codes must match
// the check constraint on course_reviews.tags (0093) and REVIEW_TAGS there;
// review-constants.test.ts holds them together.

export const MAX_REVIEW_LENGTH_CLIENT = 1000;

export const RATING_WORDS = ["", "Poor", "Fair", "Good", "Very good", "Superb"] as const;

export const REVIEW_TAG_OPTIONS = [
  { code: "condition", label: "Course condition" },
  { code: "greens", label: "Greens" },
  { code: "views", label: "Views" },
  { code: "welcome", label: "Welcome" },
  { code: "value", label: "Value" },
  { code: "pace", label: "Pace of play" },
] as const;
