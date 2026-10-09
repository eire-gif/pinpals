import { router } from "expo-router";

/**
 * Back to the Home tab from anywhere in a stack — closes every screen
 * pushed on top first, so Back from Home doesn't land on a half-finished
 * form. Used by the scorecard screens' Home buttons.
 */
export function goHome(): void {
  if (router.canDismiss()) router.dismissAll();
  router.navigate("/");
}
