const ROOT_URL =
  process.env.NEXT_PUBLIC_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000');

/**
 * MiniApp configuration object. Must follow the Farcaster MiniApp specification.
 *
 * @see {@link https://miniapps.farcaster.xyz/docs/guides/publishing}
 */
export const farcasterConfig = {
  accountAssociation: {
    header: "",
    payload: "",
    signature: ""
  },
  miniapp: {
    version: "1",
    name: "Astro Club Run",
    subtitle: "Neon escape from the starling",
    description: "Survive the Astro nightclub, dance for invulnerability, and climb the leaderboard.",
    screenshotUrls: [`${ROOT_URL}/screenshot-portrait.png`],
    iconUrl: `${ROOT_URL}/blue-icon.png`,
    splashImageUrl: `${ROOT_URL}/blue-hero.png`,
    splashBackgroundColor: "#000000",
    homeUrl: ROOT_URL,
    webhookUrl: `${ROOT_URL}/api/webhook`,
    primaryCategory: "games",
    tags: ["game", "arcade", "runner", "club", "leaderboard"],
    heroImageUrl: `${ROOT_URL}/blue-hero.png`, 
    tagline: "Dance. Dodge. Survive.",
    ogTitle: "Astro Club Run",
    ogDescription: "Dance for invulnerability, grab cocktails, and survive the beat.",
    ogImageUrl: `${ROOT_URL}/blue-hero.png`,
  },
} as const;

