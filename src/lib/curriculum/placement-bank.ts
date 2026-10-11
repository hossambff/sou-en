import type { ListeningItem, RepeatItem, SpeakingPromptItem, VocabItem } from "./types";

/**
 * Placement-test item bank, A1 → C1. The adaptive test moves up or down a level after each item,
 * so every level has its own small pool: 3 listening, 4 vocabulary, 2 repeat and 2 speaking items.
 * Everything is about an adult mom's real life — never childish.
 */

export const LISTENING_ITEMS: ListeningItem[] = [
  // A1
  {
    id: "l-a1-1",
    level: "A1",
    audio: "Hello! My name is Sara. I'm from Canada.",
    question: "Where is Sara from?",
    questionAr: "منين سارة؟",
    options: ["Canada", "Morocco", "France"],
    answer: 0,
  },
  {
    id: "l-a1-2",
    level: "A1",
    audio: "This is my son, Yanis. He's three months old, and he sleeps a lot.",
    question: "How old is Yanis?",
    questionAr: "شحال فعمر يانيس؟",
    options: ["Three years old", "Three months old", "Three weeks old"],
    answer: 1,
  },
  {
    id: "l-a1-3",
    level: "A1",
    audio: "The pharmacy opens at nine in the morning and closes at eight in the evening.",
    question: "When does the pharmacy open?",
    questionAr: "فوقاش كيتحل الفرمسيان؟",
    options: ["At eight", "At five", "At nine"],
    answer: 2,
  },
  // A2
  {
    id: "l-a2-1",
    level: "A2",
    audio: "Excuse me, the supermarket? Go straight, and it's on the left, next to the bank. You can't miss it.",
    question: "Where is the supermarket?",
    questionAr: "فين كاين السوبرمارشي؟",
    options: ["On the right, next to the bank", "On the left, next to the bank", "Opposite the bank"],
    answer: 1,
  },
  {
    id: "l-a2-2",
    level: "A2",
    audio: "Yesterday I took the baby to the doctor because he had a bad cough. Today he's much better, thank God.",
    question: "Why did she take the baby to the doctor?",
    questionAr: "علاش ديات البيبي عند الطبيب؟",
    options: ["He had a fever", "He had a bad cough", "He needed a vaccine"],
    answer: 1,
  },
  {
    id: "l-a2-3",
    level: "A2",
    audio: "Hi, it's Lisa from the clinic. We need to move your appointment from Tuesday to Thursday, same time, ten thirty.",
    question: "When is the new appointment?",
    questionAr: "فوقاش الموعد الجديد؟",
    options: ["Thursday at ten thirty", "Tuesday at ten thirty", "Thursday at two thirty"],
    answer: 0,
  },
  // B1
  {
    id: "l-b1-1",
    level: "B1",
    audio:
      "I was going to take the bus, but it was raining so hard that I called a taxi instead. Of course, the taxi got stuck in traffic for forty minutes.",
    question: "How did she travel in the end?",
    questionAr: "كيفاش مشات فالأخير؟",
    options: ["By bus", "By taxi", "On foot", "By train"],
    answer: 1,
  },
  {
    id: "l-b1-2",
    level: "B1",
    audio:
      "Honestly, I don't think the new park is better than the old one. It's bigger, sure, but there's no shade at all, and in summer that's a real problem with a baby.",
    question: "What is her main problem with the new park?",
    questionAr: "شنو هو المشكل الكبير اللي شافت فالجردة الجديدة؟",
    options: ["It's too small", "It's too far", "It's too expensive", "It has no shade"],
    answer: 3,
  },
  {
    id: "l-b1-3",
    level: "B1",
    audio:
      "I've worked at the hospital for six years, but since my daughter was born I've only been working part-time, three days a week.",
    question: "How much does she work now?",
    questionAr: "شحال كتخدم دابا؟",
    options: ["Six days a week", "Every day", "Three days a week", "She doesn't work"],
    answer: 2,
  },
  // B2
  {
    id: "l-b2-1",
    level: "B2",
    audio:
      "If the delivery had arrived on time, we wouldn't have needed to buy baby formula at the corner shop — at twice the price, I might add.",
    question: "What happened?",
    questionAr: "شنو وقع؟",
    options: [
      "The delivery was late, so they paid more at a local shop",
      "The delivery arrived early",
      "The corner shop was closed",
      "They ordered twice as much formula",
    ],
    answer: 0,
  },
  {
    id: "l-b2-2",
    level: "B2",
    audio:
      "She told me she'd been meaning to call for weeks, but what with the move and the new job, she just hadn't found the time.",
    question: "Why hadn't her friend called?",
    questionAr: "علاش ما عيطاتش ليها صاحبتها؟",
    options: ["She was angry with her", "She had lost her phone", "She had been too busy", "She forgot her number"],
    answer: 2,
  },
  {
    id: "l-b2-3",
    level: "B2",
    audio:
      "The daycare looks fine on paper, but I'm not entirely convinced. The staff seemed lovely; it's the number of babies per carer that worries me.",
    question: "What worries the speaker?",
    questionAr: "شنو اللي شاغل البال ديال اللي كتهضر؟",
    options: ["The staff", "The price", "The location", "How many babies each carer looks after"],
    answer: 3,
  },
  // C1
  {
    id: "l-c1-1",
    level: "C1",
    audio:
      "Far from being a setback, going part-time turned out to be the best decision I've made. I'm far less frazzled and, oddly enough, more productive.",
    question: "How does she feel about going part-time?",
    questionAr: "كيفاش حاسة بالخدمة نص الوقت؟",
    options: ["She regrets it", "It was a positive decision", "It made her less productive", "She hasn't decided yet"],
    answer: 1,
  },
  {
    id: "l-c1-2",
    level: "C1",
    audio:
      "I wouldn't go so far as to say screens are harmful, but I'd be wary of using them as a babysitter, especially before the age of two.",
    question: "What is the speaker's opinion?",
    questionAr: "شنو هو الرأي ديال اللي كيهضر؟",
    options: [
      "Screens are always harmful",
      "Screens are fine at any age",
      "Be careful with them, especially with very young children",
      "Babysitters are better than screens",
    ],
    answer: 2,
  },
  {
    id: "l-c1-3",
    level: "C1",
    audio:
      "Had I known how much the clinic's fees would go up, I'd have looked elsewhere. As it is, we're locked into the contract until spring.",
    question: "What is true?",
    questionAr: "شنو هو الصحيح؟",
    options: [
      "The fees went down",
      "She looked at other clinics first",
      "The contract ends this winter",
      "She can't change clinics until spring",
    ],
    answer: 3,
  },
];

export const VOCAB_ITEMS: VocabItem[] = [
  // A1
  { id: "v-a1-1", level: "A1", promptAr: "كيفاش نقولو «عييت»؟", accepted: ["tired", "i'm tired", "i am tired"] },
  {
    id: "v-a1-2",
    level: "A1",
    promptAr: "كيفاش نقولو «البيبي ناعس»؟",
    accepted: ["the baby is sleeping", "the baby's sleeping", "the baby is asleep", "the baby's asleep", "he is sleeping", "he's sleeping"],
  },
  {
    id: "v-a1-3",
    level: "A1",
    promptAr: "كيفاش نقولو «شحال فالساعة»؟",
    accepted: ["what time is it", "what's the time", "what is the time"],
  },
  { id: "v-a1-4", level: "A1", promptAr: "كيفاش نقولو «جيعانة»؟", accepted: ["hungry", "i'm hungry", "i am hungry"] },
  // A2
  {
    id: "v-a2-1",
    level: "A2",
    promptAr: "كيفاش نقولو «البيبي فيه السخانة»؟",
    accepted: [
      "the baby has a fever",
      "the baby has a temperature",
      "the baby has a high temperature",
      "he has a fever",
      "he has a temperature",
      "he's got a fever",
    ],
  },
  {
    id: "v-a2-2",
    level: "A2",
    promptAr: "كيفاش نقولو «فين كاين الفرمسيان»؟",
    accepted: ["where is the pharmacy", "where's the pharmacy", "where is the chemist", "where's the chemist", "where is the drugstore", "where's the drugstore"],
  },
  {
    id: "v-a2-3",
    level: "A2",
    promptAr: "كيفاش نقولو «البارح مشينا للبحر»؟",
    accepted: ["yesterday we went to the beach", "we went to the beach yesterday", "yesterday we went to the sea", "we went to the sea yesterday"],
  },
  {
    id: "v-a2-4",
    level: "A2",
    promptAr: "كيفاش نقولو «بغيت ناخد موعد»؟",
    accepted: [
      "i'd like to make an appointment",
      "i would like to make an appointment",
      "i'd like to book an appointment",
      "i would like to book an appointment",
      "i want to make an appointment",
      "i want to book an appointment",
    ],
  },
  // B1
  {
    id: "v-b1-1",
    level: "B1",
    promptAr: "كيفاش نقولو «كنت كنطيب ملي عيطتي»؟",
    accepted: ["i was cooking when you called"],
  },
  {
    id: "v-b1-2",
    level: "B1",
    promptAr: "كيفاش نقولو «البيبي كيطلعو ليه السنان»؟",
    accepted: ["the baby is teething", "the baby's teething", "he is teething", "he's teething", "teething"],
  },
  {
    id: "v-b1-3",
    level: "B1",
    promptAr: "كيفاش نقولو «عمري ما مشيت لإنجلترا»؟",
    accepted: [
      "i've never been to england",
      "i have never been to england",
      "i've never gone to england",
      "i have never gone to england",
      "i never went to england",
    ],
  },
  {
    id: "v-b1-4",
    level: "B1",
    promptAr: "كيفاش نقولو «ما كنظنش» (ملي ما متافقاش)؟",
    accepted: ["i don't think so", "i do not think so"],
  },
  // B2
  {
    id: "v-b2-1",
    level: "B2",
    promptAr: "كيفاش نقولو «كون كان عندي الوقت، كون سافرت»؟",
    accepted: [
      "if i had time i would travel",
      "if i had time i'd travel",
      "if i had more time i would travel",
      "if i had more time i'd travel",
      "if i had the time i would travel",
      "if i had the time i'd travel",
    ],
  },
  {
    id: "v-b2-2",
    level: "B2",
    promptAr: "كيفاش نقولو «ولفت نفيق فالليل»؟",
    accepted: [
      "i'm used to waking up at night",
      "i am used to waking up at night",
      "i've got used to waking up at night",
      "i have got used to waking up at night",
      "i got used to waking up at night",
    ],
  },
  {
    id: "v-b2-3",
    level: "B2",
    promptAr: "كيفاش نقولو «قطعو ليا الفلوس جوج مرات»؟",
    accepted: ["i was charged twice", "they charged me twice", "i've been charged twice", "i have been charged twice"],
  },
  {
    id: "v-b2-4",
    level: "B2",
    promptAr: "كيفاش نقولو «ما بقاش فيا الصبر نشوفو»؟",
    accepted: ["i can't wait to see him", "i cannot wait to see him", "i can not wait to see him"],
  },
  // C1
  {
    id: "v-c1-1",
    level: "C1",
    promptAr: "كيفاش نقولو «كون عرفت، كون جيت بكري»؟",
    accepted: [
      "if i had known i would have come earlier",
      "if i'd known i would have come earlier",
      "if i'd known i'd have come earlier",
      "if i had known i'd have come earlier",
      "had i known i would have come earlier",
    ],
  },
  {
    id: "v-c1-2",
    level: "C1",
    promptAr: "كيفاش نقولو «ما كنتش متوقعة هادشي»؟",
    accepted: [
      "i didn't see that coming",
      "i did not see that coming",
      "i wasn't expecting that",
      "i was not expecting that",
      "i didn't expect that",
      "i did not expect that",
    ],
  },
  {
    id: "v-c1-3",
    level: "C1",
    promptAr: "كيفاش نقولو «هلكت، ما بقا فيا جهد»؟",
    accepted: ["i'm exhausted", "i am exhausted", "i'm worn out", "i am worn out", "i'm shattered", "i am shattered", "i'm drained", "i am drained"],
  },
  {
    id: "v-c1-4",
    level: "C1",
    promptAr: "كيفاش نقولو «بصراحة، ما كنشوفش فيها شي فايدة»؟",
    accepted: [
      "to be honest i don't see the point",
      "to be honest i do not see the point",
      "honestly i don't see the point",
      "honestly i do not see the point",
    ],
  },
];

export const REPEAT_ITEMS: RepeatItem[] = [
  // A1 — short, everyday
  { id: "r-a1-1", level: "A1", text: "I have a baby boy.", sounds: ["h", "p-b"] },
  { id: "r-a1-2", level: "A1", text: "I think he's three months old.", sounds: ["th-voiceless", "short-i", "final-consonants"] },
  // A2
  { id: "r-a2-1", level: "A2", text: "Excuse me, where is the pharmacy, please?", sounds: ["w", "p-b", "v-f", "clusters"] },
  { id: "r-a2-2", level: "A2", text: "We walked to the park and played in the street.", sounds: ["w", "final-consonants", "clusters", "p-b"] },
  // B1
  {
    id: "r-b1-1",
    level: "B1",
    text: "I was feeding the baby when my mother called, so I couldn't answer.",
    sounds: ["v-f", "th-voiced", "schwa", "silent-letters"],
  },
  {
    id: "r-b1-2",
    level: "B1",
    text: "Have you ever thought about living somewhere else with your family?",
    sounds: ["v-f", "th-voiceless", "short-i", "h"],
  },
  // B2
  {
    id: "r-b2-1",
    level: "B2",
    text: "If I'd known the appointment was cancelled, I wouldn't have rushed through the traffic.",
    sounds: ["final-consonants", "clusters", "th-voiceless", "word-stress"],
  },
  {
    id: "r-b2-2",
    level: "B2",
    text: "I've been working part-time for three months, and honestly, it's worked out really well.",
    sounds: ["w", "th-voiceless", "silent-letters", "r"],
  },
  // C1
  {
    id: "r-c1-1",
    level: "C1",
    text: "Whether or not we agree, I think it's worth thinking the alternatives through thoroughly.",
    sounds: ["th-voiced", "th-voiceless", "w", "word-stress"],
  },
  {
    id: "r-c1-2",
    level: "C1",
    text: "Rather than rushing into a decision, I'd prefer to weigh up the pros and cons with my husband.",
    sounds: ["r", "th-voiced", "clusters", "schwa", "p-b"],
  },
];

export const SPEAKING_PROMPTS: SpeakingPromptItem[] = [
  // A1
  {
    id: "s-a1-1",
    level: "A1",
    en: "Introduce yourself: your name, where you're from and your family.",
    ar: "عرفي براسك: سميتك، منين نتي والفاميلة ديالك.",
    expectedWords: 20,
    seconds: 45,
  },
  {
    id: "s-a1-2",
    level: "A1",
    en: "Describe your morning: what do you do from when you wake up until lunch?",
    ar: "وصفي الصباح ديالك: شنو كديري من ملي كتفيقي حتى للغدا؟",
    expectedWords: 25,
    seconds: 45,
  },
  // A2
  {
    id: "s-a2-1",
    level: "A2",
    en: "Tell me what you did last weekend.",
    ar: "حكيلي شنو درتي فالويكاند اللي فات.",
    expectedWords: 35,
    seconds: 60,
  },
  {
    id: "s-a2-2",
    level: "A2",
    en: "Your baby is sick. Explain the problem to the pharmacist and ask for help.",
    ar: "البيبي ديالك مريض. شرحي المشكل للفرمسيان وطلبي منو يعاونك.",
    expectedWords: 40,
    seconds: 60,
  },
  // B1
  {
    id: "s-b1-1",
    level: "B1",
    en: "Tell me about the day your baby was born, or another day you'll never forget.",
    ar: "حكيلي على النهار اللي تزاد فيه البيبي ديالك، ولا شي نهار آخر عمرك ما غادي تنسايه.",
    expectedWords: 70,
    seconds: 75,
  },
  {
    id: "s-b1-2",
    level: "B1",
    en: "Should young children have phones and tablets? Give your opinion and two reasons.",
    ar: "واش خاص الدراري الصغار يكون عندهم التيليفونات والتابليطات؟ عطيني الرأي ديالك وجوج دالأسباب.",
    expectedWords: 60,
    seconds: 60,
  },
  // B2
  {
    id: "s-b2-1",
    level: "B2",
    en: "If you could change one thing about your city, what would it be, and why?",
    ar: "كون تقدري تبدلي حاجة وحدة فالمدينة ديالك، شنو تكون، وعلاش؟",
    expectedWords: 90,
    seconds: 75,
  },
  {
    id: "s-b2-2",
    level: "B2",
    en: "Tell me about a difficult situation you've faced and how you dealt with it.",
    ar: "حكيلي على شي موقف صعيب دوزتيه وكيفاش دبرتي راسك.",
    expectedWords: 100,
    seconds: 90,
  },
  // C1
  {
    id: "s-c1-1",
    level: "C1",
    en: "Some people say parents should never use screens to calm a child. Discuss both sides and give your own view.",
    ar: "كاين اللي كيقول الواليدين عمرهم ما خاصهم يستعملو الشاشات باش يهدنو الدراري. ناقشي جوج الجهات وعطي الرأي ديالك.",
    expectedWords: 130,
    seconds: 90,
  },
  {
    id: "s-c1-2",
    level: "C1",
    en: "How has becoming a mother changed the way you see the world? Give examples.",
    ar: "كيفاش بدلات الأمومة الطريقة اللي كتشوفي بيها الدنيا؟ عطي أمثلة.",
    expectedWords: 140,
    seconds: 90,
  },
];
