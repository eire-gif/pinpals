import type { ImageSourcePropType } from "react-native";

import { coursePhotoIndex } from "@/lib/tee-times";

/**
 * PinPals' course photographs (tools/prep-tee-time-images.py). No club in
 * the directory has a photo of its own yet, so cards pick one of these
 * steadily per club — the tee-time cards and the round recap both use this,
 * so a course looks the same wherever it appears.
 */
export const COURSE_PHOTOS: ImageSourcePropType[] = [
  require("../../assets/images/courses/course-1.jpg"),
  require("../../assets/images/courses/course-2.jpg"),
  require("../../assets/images/courses/course-3.jpg"),
  require("../../assets/images/courses/course-4.jpg"),
  require("../../assets/images/courses/course-5.jpg"),
  require("../../assets/images/courses/course-6.jpg"),
  require("../../assets/images/courses/course-7.jpg"),
  require("../../assets/images/courses/course-8.jpg"),
];

/** The photograph for a club, by id (or name, for older website rows). */
export function coursePhoto(clubId: number | null, clubName: string | null): ImageSourcePropType {
  return COURSE_PHOTOS[coursePhotoIndex({ club_id: clubId, club_name: clubName }, COURSE_PHOTOS.length)];
}
