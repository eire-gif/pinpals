/**
 * Set for 24 hours on a device whose sign-up was turned away as under 13
 * (0159). Read by the sign-up page and its action; nothing else. Not a
 * security boundary — clearing cookies gets round it — but it stops the
 * obvious "try again with an earlier year" straight after being told no.
 */
export const AGE_BLOCK_COOKIE = "pp_age_block";
export const AGE_BLOCK_SECONDS = 24 * 60 * 60;
