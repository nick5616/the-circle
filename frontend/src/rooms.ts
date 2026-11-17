// Rooms: the one big fire everybody shares ("main"), plus little private ones
// you get into with a code. Codes are words, not meeting IDs: cozy-moth-42.
//
// URLs: "/" is the main circle, "/r/<code>" is a private room.

export const MAIN = "main";

const ADJ = [
  "cozy", "sleepy", "golden", "fuzzy", "tiny", "wild", "soft", "glowy", "lucky", "mossy",
  "velvet", "rosy", "toasty", "dreamy", "giggly", "misty", "starry", "honey", "bubbly", "cosmic",
  "silly", "gentle", "crispy", "sunny", "frosty", "sparkly", "brave", "witchy", "peachy", "smoky",
];
const NOUN = [
  "moth", "ember", "otter", "fern", "comet", "frog", "pine", "lantern", "fox", "owl",
  "moon", "peach", "cricket", "acorn", "firefly", "clover", "raccoon", "bean", "pebble", "mushroom",
  "sprout", "kettle", "puffin", "cocoa", "maple", "marsh", "toad", "willow", "beetle", "spark",
];

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

export function newRoomCode(): string {
  return `${pick(ADJ)}-${pick(NOUN)}-${10 + Math.floor(Math.random() * 90)}`;
}

/** Mirrors rooms/room_state.py clean_room: "Cozy Moth 42" → "cozy-moth-42". Empty → main. */
export function cleanRoom(raw: string): string {
  const code = raw
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  return code || MAIN;
}

export function roomFromUrl(): string {
  const m = /^\/r\/([^/?#]+)/.exec(location.pathname);
  if (m) return cleanRoom(decodeURIComponent(m[1]));
  const q = new URLSearchParams(location.search).get("room");
  return q ? cleanRoom(q) : MAIN;
}

export function roomPath(rid: string): string {
  return rid === MAIN ? "/" : `/r/${rid}`;
}

export function inviteLink(rid: string): string {
  return `${location.origin}${roomPath(rid)}`;
}

// Rooms you've been in recently, so you can wander back
const RECENT_KEY = "circle:rooms";

export function recentRooms(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== MAIN).slice(0, 4) : [];
  } catch {
    return [];
  }
}

export function rememberRoom(rid: string): void {
  if (rid === MAIN) return;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([rid, ...recentRooms().filter((r) => r !== rid)].slice(0, 4)));
  } catch {}
}

export function forgetRoom(rid: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentRooms().filter((r) => r !== rid)));
  } catch {}
}
