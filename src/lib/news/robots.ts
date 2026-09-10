/**
 * A small robots.txt parser, enough to decide whether we are allowed to
 * fetch a given path.
 *
 * This is not a courtesy. Fetching a URL the host's robots.txt disallows is
 * a separate problem from copyright — it is the operator telling us not to,
 * in the one machine-readable place they have to say it. The collector calls
 * `isPathAllowed()` before every request and refuses on false, with no
 * override flag anywhere in the codebase. If a source needs to be read and
 * robots says no, the answer is an email to the press office, not a
 * bypass.
 *
 * Matching follows the widely-implemented convention: within the group that
 * applies to us, the longest matching rule wins, and Allow beats Disallow on
 * an exact-length tie. `*` wildcards and a trailing `$` anchor are honoured.
 */

export const USER_AGENT =
  "PinpalsNewsBot/1.0 (+https://pinpals.ie/news/about)";

/** The token we match against `User-agent:` lines, lowercased. */
const UA_TOKEN = "pinpalsnewsbot";

interface Rule {
  allow: boolean;
  pattern: string;
}

export interface RobotsRules {
  /** Rules for the most specific matching group. */
  rules: Rule[];
  /** Seconds, if the applicable group set one. Not currently enforced. */
  crawlDelay: number | null;
}

/**
 * Parse robots.txt into the rule set that applies to us.
 *
 * A file that names us explicitly wins over the `*` group; if neither
 * appears, no rules apply and everything is allowed.
 */
export function parseRobots(text: string): RobotsRules {
  const starRules: Rule[] = [];
  const oursRules: Rule[] = [];
  let starDelay: number | null = null;
  let oursDelay: number | null = null;

  // A blank line ends a group, so agents only accumulate while we are still
  // inside the User-agent block that opened it.
  let agents: string[] = [];
  let inGroup = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line === "") {
      agents = [];
      inGroup = false;
      continue;
    }

    const sep = line.indexOf(":");
    if (sep === -1) continue;

    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (field === "user-agent") {
      // Consecutive User-agent lines share one group of rules.
      if (inGroup) agents = [];
      agents.push(value.toLowerCase());
      inGroup = false;
      continue;
    }

    if (agents.length === 0) continue;
    inGroup = true;

    const targets: Rule[][] = [];
    if (agents.includes("*")) targets.push(starRules);
    if (agents.some((a) => a === UA_TOKEN || a.startsWith(UA_TOKEN))) {
      targets.push(oursRules);
    }
    if (targets.length === 0) continue;

    if (field === "disallow" || field === "allow") {
      // "Disallow:" with an empty value means "nothing is disallowed", which
      // is an allow-all, not a rule matching every path.
      if (field === "disallow" && value === "") continue;
      for (const t of targets) t.push({ allow: field === "allow", pattern: value });
    } else if (field === "crawl-delay") {
      const n = Number.parseFloat(value);
      if (Number.isFinite(n)) {
        if (agents.includes("*")) starDelay = n;
        if (agents.some((a) => a.startsWith(UA_TOKEN))) oursDelay = n;
      }
    }
  }

  // A group naming us explicitly replaces the wildcard group entirely,
  // rather than adding to it.
  const useOurs = oursRules.length > 0 || oursDelay !== null;
  return {
    rules: useOurs ? oursRules : starRules,
    crawlDelay: useOurs ? oursDelay : starDelay,
  };
}

/** Convert a robots pattern to a regex, honouring `*` and a trailing `$`. */
function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + escaped + (anchored ? "$" : ""));
}

/**
 * Longest match wins; Allow wins a tie. An empty rule set allows everything.
 */
export function isPathAllowed(robots: RobotsRules, pathWithQuery: string): boolean {
  let best: { allow: boolean; length: number } | null = null;

  for (const rule of robots.rules) {
    if (rule.pattern === "") continue;
    if (!patternToRegex(rule.pattern).test(pathWithQuery)) continue;

    const length = rule.pattern.replace(/\$$/, "").length;
    if (
      best === null ||
      length > best.length ||
      (length === best.length && rule.allow && !best.allow)
    ) {
      best = { allow: rule.allow, length };
    }
  }

  return best === null ? true : best.allow;
}

/** The path plus query string a robots rule is matched against. */
export function robotsPath(url: string): string {
  const u = new URL(url);
  return u.pathname + (u.search || "");
}

/**
 * Fetch and evaluate robots.txt for a URL's host.
 *
 * A 404 (or any 4xx) means no robots.txt exists, which by convention permits
 * everything. A network failure or a 5xx is NOT treated as permission — if
 * we cannot read the file we do not assume consent, we skip the source this
 * run and try again next time.
 */
export async function checkRobots(
  targetUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ allowed: boolean; reason: string }> {
  const { rules, reason } = await fetchRobotsRules(targetUrl, fetchImpl);
  if (!rules) return { allowed: false, reason };

  const path = robotsPath(targetUrl);
  const allowed = isPathAllowed(rules, path);
  return {
    allowed,
    reason: allowed ? `robots.txt allows ${path}` : `robots.txt disallows ${path}`,
  };
}

/**
 * Fetch a host's robots.txt once and return the parsed rules.
 *
 * A sitemap source tests many paths against the same file — the sitemap
 * itself, then every article URL in it. Calling checkRobots per URL would
 * re-download robots.txt a dozen times a run, which is both wasteful and, on
 * a host counting requests, rude.
 *
 * `rules: null` means we could not read the file, which is NOT permission.
 * An empty rule set, by contrast, means we read it and it permits everything.
 */
export async function fetchRobotsRules(
  targetUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ rules: RobotsRules | null; reason: string }> {
  const robotsUrl = new URL("/robots.txt", targetUrl).toString();

  let response: Response;
  try {
    response = await fetchImpl(robotsUrl, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return {
      rules: null,
      reason: `could not read robots.txt (${error instanceof Error ? error.message : "network error"})`,
    };
  }

  if (response.status >= 400 && response.status < 500) {
    return {
      rules: { rules: [], crawlDelay: null },
      reason: `no robots.txt (HTTP ${response.status})`,
    };
  }
  if (!response.ok) {
    return { rules: null, reason: `robots.txt unavailable (HTTP ${response.status})` };
  }

  return { rules: parseRobots(await response.text()), reason: "robots.txt read" };
}
