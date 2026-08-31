import clubsJson from "@/data/clubs.json";

// The canonical list of Irish golf clubs. This is also what seeds the
// `clubs` table in Supabase (see supabase/migrations/0002_seed_clubs.sql) —
// keep the two in sync if you ever add or rename a club.
export const CLUBS: string[] = clubsJson as string[];

export const COUNTIES = [
  "Antrim", "Armagh", "Carlow", "Cavan", "Clare", "Cork", "Derry", "Donegal",
  "Down", "Dublin", "Fermanagh", "Galway", "Kerry", "Kildare", "Kilkenny",
  "Laois", "Leitrim", "Limerick", "Longford", "Louth", "Mayo", "Meath",
  "Monaghan", "Offaly", "Roscommon", "Sligo", "Tipperary", "Tyrone",
  "Waterford", "Westmeath", "Wexford", "Wicklow",
] as const;
