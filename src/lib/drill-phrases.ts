// Curated Shadow Me phrases for Sou's six months, plus the picker that mixes in her own words.
// Pure data and logic — safe on client and server.

export type FocusSound =
  | "p/b"
  | "th"
  | "short i"
  | "v/f"
  | "w"
  | "h"
  | "r"
  | "-ed endings"
  | "-ing"
  | "schwa"
  | "word stress"
  | "sentence stress"
  | "linking"
  | "intonation";

export type DrillPhrase = {
  id: string;
  month: 1 | 2 | 3 | 4 | 5 | 6;
  en: string;
  /** Darija meaning in Arabic script */
  ar: string;
  focus: FocusSound;
};

export type ShadowItem = {
  id: string;
  en: string;
  /** Darija meaning (curated, garden word) or Hossam's Darija tip (golden fix) */
  ar: string;
  focus: FocusSound | "garden" | "fix";
  source: "curated" | "garden" | "fix";
};

/** One gentle tip per focus sound, shown after an attempt that wasn't perfect. */
export const FOCUS_TIPS: Record<ShadowItem["focus"], { label: string; en: string; ar: string }> = {
  "p/b": {
    label: "P / B",
    en: "'P' has a little puff of air. Hold your hand near your lips: you feel it on 'p', not on 'b'.",
    ar: "ف 'P' كيخرج شوية ديال الهوا. حطي يدك قدام فمك: كتحسي بالهوا ف P، ماشي ف B.",
  },
  th: {
    label: "TH",
    en: "For 'th', put the tip of your tongue softly between your teeth and blow. Not 's', not 'd'.",
    ar: "ف 'th' حطي راس لسانك بين سنانك بشوية ونفخي. ماشي 's' وماشي 'd'.",
  },
  "short i": {
    label: "short i",
    en: "Short 'i' (sit, this, live) is quick and relaxed. Long 'ee' (seat, sheep) smiles and stretches.",
    ar: "'i' القصيرة (sit, this) سريعة ومرتاحة. 'ee' الطويلة (seat, sheep) فيها ابتسامة وكتطول.",
  },
  "v/f": {
    label: "V / F",
    en: "For 'v', touch your top teeth to your bottom lip and let your voice buzz. 'F' is the same with only air.",
    ar: "ف 'v' حطي السنان الفوقانيين على الشفة اللتحتانية وخلي الصوت يخرج. 'F' بحالها ولكن غير الهوا.",
  },
  w: {
    label: "W",
    en: "For 'w', round your lips like a small kiss, then open. It's not a 'v'!",
    ar: "ف 'w' دوري شفايفك بحال شي بوسة صغيرة ومن بعد حليهم. ماشي 'v'!",
  },
  h: {
    label: "H",
    en: "English 'h' is just a soft breath, like fogging a mirror. Softer than ح.",
    ar: "'h' ف النجليزية غير نفس خفيف، بحال ملي كتنفخي على المرايا. أخف من ح.",
  },
  r: {
    label: "R",
    en: "English 'r' doesn't roll. Pull your tongue back and don't touch the top of your mouth.",
    ar: "'r' ف النجليزية ما كترعدش بحال الدارجة. رجعي لسانك اللور وما تقيسيش الفوق ديال فمك.",
  },
  "-ed endings": {
    label: "-ed",
    en: "Past '-ed' usually sounds like 't' or 'd', with no extra syllable: walked = 'walkt'. Only after t/d it's 'id': started.",
    ar: "'ed' ف الماضي غالبا كتنطق 't' ولا 'd' بلا ما تزيدي مقطع: walked = 'walkt'. غير من بعد t ولا d كتولي 'id'.",
  },
  "-ing": {
    label: "-ing",
    en: "'-ing' ends in your nose, with no hard 'g' at the end: 'looking', not 'lookin-g'.",
    ar: "'ing' كتسالي ف النيف، بلا 'g' قوية ف اللخر.",
  },
  schwa: {
    label: "small words",
    en: "Small words like 'a', 'to', 'of', 'for' become a tiny relaxed 'uh'. Don't say them fully.",
    ar: "الكلمات الصغار بحال 'a' و 'to' و 'of' كيوليو 'uh' صغيرة ومرتاحة. ما تنطقيهمش كاملين.",
  },
  "word stress": {
    label: "word stress",
    en: "One part of a long word is louder and longer: to-MOR-row, DOC-tor. Push that part a little.",
    ar: "كاين جزء ف الكلمة الطويلة كيكون أقوى وأطول: to-MOR-row، DOC-tor. ضغطي عليه شوية.",
  },
  "sentence stress": {
    label: "rhythm",
    en: "Say the important words louder and slower. The small words can be quick.",
    ar: "الكلمات المهمة قوليهم بصوت أعلى وبشوية. الكلمات الصغار دوزيهم بالزربة.",
  },
  linking: {
    label: "linking",
    en: "Glue the words together like one long word: 'turn it off' sounds like 'tur-ni-toff'.",
    ar: "لصقي الكلمات مع بعضياتهم بحال كلمة وحدة: 'turn it off' كتولي 'tur-ni-toff'.",
  },
  intonation: {
    label: "melody",
    en: "Yes/no questions go up at the end ↗, normal sentences go down ↘. Let your voice sing a little.",
    ar: "السؤال ديال واش كيطلع ف اللخر ↗، والجملة العادية كتهبط ↘. خلي صوتك يغني شوية.",
  },
  garden: {
    label: "from your garden",
    en: "This one grew in your own Word Garden. Say it like you mean it!",
    ar: "هادي من الجنان ديالك. قوليها بالثقة!",
  },
  fix: {
    label: "your golden fix",
    en: "This is one of your golden fixes. Say it a few times and it will stick.",
    ar: "هادا واحد من التصحيحات ديالك. عاوديه شحال من مرة وغادي يتشد.",
  },
};

export const DRILL_PHRASES: DrillPhrase[] = [
  // Month 1 · Casablanca · "Me and my baby": present simple, can, survival chunks, p/v/short vowels
  { id: "m1-tired", month: 1, en: "I'm so tired, I only slept three hours.", ar: "عييت بزاف، نعست غير تلت سوايع.", focus: "th" },
  { id: "m1-my-baby", month: 1, en: "This is my baby.", ar: "هادا البيبي ديالي.", focus: "short i" },
  { id: "m1-months", month: 1, en: "My baby is two months old.", ar: "البيبي ديالي عندو شهرين.", focus: "th" },
  { id: "m1-sleeping", month: 1, en: "The baby is sleeping. Please speak quietly.", ar: "البيبي ناعس. عافاك هضر بشوية.", focus: "p/b" },
  { id: "m1-help", month: 1, en: "Can you help me, please?", ar: "واش تقدر تعاوني عافاك؟", focus: "intonation" },
  { id: "m1-bottle", month: 1, en: "I need a bottle and a clean diaper.", ar: "خاصني شي بيبرون وشي كوش نقي.", focus: "p/b" },
  { id: "m1-live", month: 1, en: "I live in Casablanca with my husband.", ar: "كنسكن ف كازا مع راجلي.", focus: "short i" },
  { id: "m1-busy", month: 1, en: "I have a very busy day.", ar: "عندي نهار عامر بزاف.", focus: "v/f" },
  { id: "m1-wait", month: 1, en: "Wait a minute, the baby is crying.", ar: "تسنى دقيقة، البيبي كيبكي.", focus: "w" },
  { id: "m1-happy", month: 1, en: "I feel happy when my baby smiles.", ar: "كنفرح ملي كيضحك البيبي ديالي.", focus: "h" },

  // Month 2 · Marrakech · "Out and about": past simple, going to, polite requests, pharmacy & transport
  { id: "m2-pharmacy", month: 2, en: "Excuse me, where is the pharmacy?", ar: "سمح ليا، فين كاينة الفرمسيان؟", focus: "word stress" },
  { id: "m2-fever", month: 2, en: "I'd like some medicine for a fever.", ar: "بغيت شي دوا ديال السخانة.", focus: "v/f" },
  { id: "m2-cough", month: 2, en: "My baby had a cough last night.", ar: "البيبي ديالي كانت فيه الكحبة البارح ف الليل.", focus: "h" },
  { id: "m2-park", month: 2, en: "We walked to the park yesterday.", ar: "مشينا للجردة على رجلينا البارح.", focus: "-ed endings" },
  { id: "m2-how-much", month: 2, en: "How much is this, please?", ar: "شحال هادي عافاك؟", focus: "short i" },
  { id: "m2-doctor", month: 2, en: "I'm going to call the doctor tomorrow.", ar: "غادي نعيط للطبيب غدا.", focus: "word stress" },
  { id: "m2-slowly", month: 2, en: "Could you speak more slowly, please?", ar: "واش ممكن تهضر بشوية عافاك؟", focus: "linking" },
  { id: "m2-wipes", month: 2, en: "I'm looking for baby wipes.", ar: "كنقلب على اللانجيت ديال البيبي.", focus: "-ing" },
  { id: "m2-taxi", month: 2, en: "The bus was late, so I took a taxi.", ar: "الطوبيس تعطل، داكشي علاش خديت طاكسي.", focus: "sentence stress" },
  { id: "m2-card", month: 2, en: "Can I pay by card?", ar: "واش نقدر نخلص بالكارط؟", focus: "p/b" },

  // Month 3 · Tangier · "Telling stories": past continuous, linking words, sentence stress
  { id: "m3-feeding", month: 3, en: "I was feeding the baby when you called.", ar: "كنت كنوكل البيبي ملي عيطتي.", focus: "sentence stress" },
  { id: "m3-first", month: 3, en: "First we had breakfast, then we went out.", ar: "اللول فطرنا، ومن بعد خرجنا.", focus: "linking" },
  { id: "m3-happiest", month: 3, en: "It was the happiest day of my life.", ar: "كان أسعد نهار ف حياتي.", focus: "h" },
  { id: "m3-laughing", month: 3, en: "Suddenly, the baby started laughing.", ar: "فجأة، البيبي بدا كيضحك.", focus: "-ed endings" },
  { id: "m3-nervous", month: 3, en: "I was so nervous, but everything was fine.", ar: "كنت خايفة بزاف، ولكن كولشي داز مزيان.", focus: "v/f" },
  { id: "m3-visited", month: 3, en: "We visited my family in Marrakech.", ar: "زرنا العائلة ديالي ف مراكش.", focus: "v/f" },
  { id: "m3-woke", month: 3, en: "While I was cooking, the baby woke up.", ar: "ملي كنت كنطيب، البيبي فاق.", focus: "w" },
  { id: "m3-raining", month: 3, en: "It was raining, so we stayed at home.", ar: "كانت الشتا، داكشي علاش بقينا ف الدار.", focus: "r" },
  { id: "m3-mother", month: 3, en: "My mother came to help me for a week.", ar: "ماما جات تعاوني واحد السيمانة.", focus: "schwa" },
  { id: "m3-forget", month: 3, en: "I'll never forget that moment.", ar: "عمري ما غادي ننسى ديك اللحظة.", focus: "word stress" },

  // Month 4 · Dublin · "What I think": present perfect, comparatives, opinions
  { id: "m4-mom", month: 4, en: "I've been a mom for four months now.", ar: "هادي ربعة شهور وأنا ماما.", focus: "v/f" },
  { id: "m4-opinion", month: 4, en: "In my opinion, sleep is more important than money.", ar: "ف رأيي، النعاس أهم من الفلوس.", focus: "word stress" },
  { id: "m4-agree", month: 4, en: "I totally agree with you.", ar: "متافقة معاك مية ف المية.", focus: "sentence stress" },
  { id: "m4-depends", month: 4, en: "I see your point, but I think it depends.", ar: "فهمتك، ولكن كنظن على حساب.", focus: "th" },
  { id: "m4-tried", month: 4, en: "I've never tried that before.", ar: "عمري ما جربت هادي من قبل.", focus: "-ed endings" },
  { id: "m4-cheaper", month: 4, en: "This one is cheaper and better.", ar: "هادي أرخص وحسن.", focus: "p/b" },
  { id: "m4-teenagers", month: 4, en: "Babies are much easier than teenagers!", ar: "الصغار أسهل بزاف من المراهقين!", focus: "sentence stress" },
  { id: "m4-rather", month: 4, en: "I'd rather stay home tonight.", ar: "كنفضل نبقى ف الدار هاد الليلة.", focus: "r" },
  { id: "m4-london", month: 4, en: "Have you ever been to London?", ar: "واش عمرك مشيتي للندن؟", focus: "intonation" },
  { id: "m4-honest", month: 4, en: "I don't think so, to be honest.", ar: "ما كنظنش، بصراحة.", focus: "th" },

  // Month 5 · London · "Handling it": phone calls, modals, conditionals, small talk
  { id: "m5-appointment", month: 5, en: "Hi, I'm calling about my appointment.", ar: "السلام، كنعيط على قبل الموعد ديالي.", focus: "linking" },
  { id: "m5-manager", month: 5, en: "Could I speak to the manager, please?", ar: "واش نقدر نهضر مع المسؤول عافاك؟", focus: "p/b" },
  { id: "m5-call-back", month: 5, en: "If I have time, I'll call you back.", ar: "إلا كان عندي الوقت، غادي نعاود نعيط ليك.", focus: "v/f" },
  { id: "m5-bill", month: 5, en: "I'm afraid there's a problem with my bill.", ar: "سمح ليا، كاين شي مشكل ف الفاكتورة ديالي.", focus: "p/b" },
  { id: "m5-repeat", month: 5, en: "Sorry, could you repeat that?", ar: "سمح ليا، واش تقدر تعاود داكشي؟", focus: "word stress" },
  { id: "m5-get-back", month: 5, en: "Let me check and get back to you.", ar: "خليني نشوف ونرجع ليك.", focus: "linking" },
  { id: "m5-ages", month: 5, en: "It's been ages since I've seen you!", ar: "شحال هادي ما شفتك!", focus: "short i" },
  { id: "m5-door", month: 5, en: "Would you mind holding the door?", ar: "واش ممكن تشد ليا الباب؟", focus: "w" },
  { id: "m5-booked", month: 5, en: "I should have booked it earlier.", ar: "كان خاصني نحجز بكري.", focus: "schwa" },
  { id: "m5-weather", month: 5, en: "The weather is lovely today, isn't it?", ar: "الجو زوين اليوم، ياك؟", focus: "intonation" },

  // Month 6 · New York · "Being myself in English": rhythm, idioms, connected speech
  { id: "m6-proud", month: 6, en: "To be honest, I'm really proud of myself.", ar: "بصراحة، أنا فخورة براسي بزاف.", focus: "sentence stress" },
  { id: "m6-explain", month: 6, en: "Well, it's kind of hard to explain.", ar: "واخا، صعيب شوية نشرحها.", focus: "schwa" },
  { id: "m6-weekend", month: 6, en: "I'm looking forward to the weekend.", ar: "كنتسنى الويكاند بفارغ الصبر.", focus: "w" },
  { id: "m6-growing", month: 6, en: "My baby is growing up so fast!", ar: "البيبي ديالي كيكبر بالزربة!", focus: "-ing" },
  { id: "m6-agree-more", month: 6, en: "I couldn't agree more.", ar: "متافقة معاك تماما.", focus: "sentence stress" },
  { id: "m6-by-ear", month: 6, en: "Let's play it by ear.", ar: "نشوفو كيفاش تجي الأمور.", focus: "linking" },
  { id: "m6-moon", month: 6, en: "I'm over the moon about it.", ar: "فرحانة بزاف، طايرة بالفرحة.", focus: "v/f" },
  { id: "m6-hang-on", month: 6, en: "Hang on, let me think about it.", ar: "تسنى شوية، خليني نفكر فيها.", focus: "th" },
  { id: "m6-cake", month: 6, en: "It was a piece of cake!", ar: "كانت ساهلة بزاف!", focus: "p/b" },
  { id: "m6-long-way", month: 6, en: "Honestly, I've come a long way.", ar: "بصراحة، وصلت لبعيد.", focus: "w" },
];

export type PersonalPhrase = { en: string; ar: string; source: "garden" | "fix" };

/** Fisher–Yates with an injectable random source (for tests). */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Short enough to shadow in one breath. */
export function isShadowable(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words >= 1 && words <= 12 && text.length <= 90;
}

/**
 * Picks a Shadow Me round: phrases from her current month (earlier months as backup, phrases she
 * drilled recently last), with up to `maxPersonal` of her own garden words / golden fixes mixed in.
 */
export function pickShadowItems(options: {
  month: number;
  personal?: PersonalPhrase[];
  recentTargets?: Iterable<string>;
  count?: number;
  maxPersonal?: number;
  random?: () => number;
}): ShadowItem[] {
  const { count = 5, maxPersonal = 2, random = Math.random } = options;
  const month = Math.min(6, Math.max(1, Math.round(options.month) || 1));
  const recent = new Set([...(options.recentTargets ?? [])].map((t) => t.trim().toLowerCase()));
  const isRecent = (text: string) => recent.has(text.trim().toLowerCase());

  const seen = new Set<string>();
  const personal: ShadowItem[] = [];
  for (const phrase of options.personal ?? []) {
    if (personal.length >= Math.min(maxPersonal, count)) break;
    const key = phrase.en.trim().toLowerCase();
    if (!isShadowable(phrase.en) || seen.has(key)) continue;
    seen.add(key);
    personal.push({
      id: `${phrase.source}:${key}`,
      en: phrase.en.trim(),
      ar: phrase.ar.trim(),
      focus: phrase.source,
      source: phrase.source,
    });
  }

  // This month first, then earlier months (closest first), then later ones.
  // Phrases she drilled in the last few days go to the very end, so rounds stay fresh.
  const byPreference = (m: number) => (m === month ? 0 : m < month ? month - m : 10 + m);
  const pool = [...new Set(DRILL_PHRASES.map((p) => p.month))]
    .sort((a, b) => byPreference(a) - byPreference(b))
    .flatMap((m) =>
      shuffle(
        DRILL_PHRASES.filter((p) => p.month === m),
        random,
      ),
    );
  const ordered = [...pool.filter((p) => !isRecent(p.en)), ...pool.filter((p) => isRecent(p.en))];

  const curated: ShadowItem[] = [];
  for (const phrase of ordered) {
    if (curated.length >= count - personal.length) break;
    const key = phrase.en.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    curated.push({ id: phrase.id, en: phrase.en, ar: phrase.ar, focus: phrase.focus, source: "curated" });
  }

  // Personal items go in 2nd and 4th place so the round starts with a curated warm-up
  const items = [...curated];
  personal.forEach((item, i) => items.splice(Math.min(items.length, 1 + i * 2), 0, item));
  return items;
}
