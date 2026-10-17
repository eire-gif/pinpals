"use client";

import { useEffect } from "react";

/** The card check is over: the approval link's secret needn't stay in this tab (see parent-approval.tsx). */
export default function ForgetParentToken() {
  useEffect(() => {
    try {
      window.sessionStorage.removeItem("pp_parent_token");
    } catch {}
  }, []);
  return null;
}
