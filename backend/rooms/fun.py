"""
The playful bits: campfire question cards, chat dice, and the fire's opinions.

Everything random happens server-side so the whole room sees the same roll.
"""

import random
import re

# Question cards ("sparks"). Light, weird, personal-but-not-heavy. No icebreaker
# energy, nothing that sounds like a team offsite.
SPARKS = [
    "what's a hill you would genuinely die on?",
    "what's the best thing you ate this week?",
    "what's a song you'd put on right now if this fire had a speaker?",
    "what's your most useless talent?",
    "what did you believe as a kid that was extremely wrong?",
    "what's a smell that instantly takes you somewhere?",
    "if you had to live inside one video game, which one?",
    "what's the weirdest thing in your search history this month?",
    "what's a tiny thing that made you happy today?",
    "what would your entrance music be?",
    "what's the best bad movie you've ever seen?",
    "what's something you're irrationally scared of?",
    "what's a snack combo people judge you for?",
    "if animals could talk, which one would be the rudest?",
    "what's the last thing you got way too into?",
    "what's a word you love the sound of?",
    "what fictional place would you move to tomorrow?",
    "what's your go-to karaoke song (or the one you'd never admit to)?",
    "what's a compliment you still think about?",
    "what's the most chaotic thing you've done on a whim?",
    "what's a dream you had that you still remember?",
    "what's your comfort show?",
    "if you opened a tiny shop, what would it sell?",
    "what's a hobby you'd pick up if time and money didn't exist?",
    "what's the best advice you ignored?",
    "what's a conspiracy theory you kind of want to be true?",
    "what's the coziest place you've ever been?",
    "what was your first username online?",
    "what's a food you'll never forgive?",
    "which cryptid would you befriend?",
    "what's something you'd love to be really good at by next year?",
    "what's the funniest thing that happened to you this year?",
    "you get one superpower but it's mildly inconvenient. what is it?",
    "what's a song that's way better than it has any right to be?",
    "what's your hot take that's actually lukewarm?",
    "what's a place you've never been but think about a lot?",
    "what's the most you've ever laughed?",
    "what's your ideal lazy sunday?",
    "what's something small you'd ban if you ran the world?",
    "who in your life deserves a little shoutout right now?",
    "would you rather fight one horse-sized duck or a hundred duck-sized horses?",
    "would you rather always be slightly too hot or slightly too cold?",
    "would you rather only whisper or only shout for a year?",
    "would you rather have a pet dragon the size of a cat or a cat the size of a dragon?",
    "would you rather know every language or be able to talk to animals?",
    "would you rather live in the woods with great wifi or in a city with none?",
    "what's a meal you'd cook over this fire?",
    "describe your vibe as a weather pattern.",
    "what's the most underrated season and why is it autumn?",
    "what would your ghost haunt?",
]

# Asking the fire a question (/ask). It is mostly supportive and sometimes not.
FIRE_ANSWERS = [
    "the fire crackles: yes.",
    "the fire crackles: absolutely.",
    "the fire pops loudly. that's a yes.",
    "the fire flares up. the answer is yes, obviously.",
    "the fire glows warmly. it's going to be okay.",
    "the fire sends up a single spark. signs point to yes.",
    "the fire hisses. no.",
    "the fire smolders. not today.",
    "the fire goes very quiet. ask again later.",
    "the fire shifts a log. it's thinking about it.",
    "the fire says: you already know the answer.",
    "the fire turns briefly green. nobody knows what that means.",
    "the fire laughs at you, affectionately.",
    "the fire says: only if you bring snacks.",
    "the fire says: be brave.",
    "the fire says: absolutely not, bestie.",
]

# Things you can toss at someone's tile
THROWABLES = {"🍡", "🌸", "💌", "🍪", "🧦", "🎈", "🐸"}

_DICE = re.compile(r"^(?:(\d{1,2})d)?(\d{1,4})$")


def draw_spark(exclude: str | None = None) -> str:
    choices = [s for s in SPARKS if s != exclude] or SPARKS
    return random.choice(choices)


def chat_command(text: str) -> tuple[str, str] | None:
    """
    Turn a slash command into (kind, content) — the content reads after the
    sender's name, e.g. "rolled a 4 🎲". Returns None for ordinary messages.
    Unknown commands fall through and are posted as normal text.
    """
    if not text.startswith("/"):
        return None
    cmd, _, rest = text[1:].partition(" ")
    cmd = cmd.lower()
    rest = rest.strip()

    if cmd == "me" and rest:
        return "me", rest[:300]

    if cmd in ("roll", "dice"):
        m = _DICE.match(rest.replace(" ", "").lower() or "6")
        count, sides = (int(m.group(1) or 1), int(m.group(2))) if m else (1, 6)
        count = max(1, min(count, 10))
        sides = max(2, min(sides, 1000))
        rolls = [random.randint(1, sides) for _ in range(count)]
        if count == 1:
            return "roll", f"rolled a {rolls[0]} 🎲 (d{sides})"
        return "roll", f"rolled {count}d{sides}: {' + '.join(map(str, rolls))} = {sum(rolls)} 🎲"

    if cmd in ("flip", "coin"):
        return "flip", f"flipped a coin: {random.choice(['heads', 'tails'])} 🪙"

    if cmd in ("ask", "8ball", "fire") and rest:
        q = rest[:200]
        return "ask", f'asked the fire "{q}" — {random.choice(FIRE_ANSWERS)}'

    return None
