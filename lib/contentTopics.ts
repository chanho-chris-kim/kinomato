// Content topics for topic limits (docs/onboarding-spec.md §5.10, ruled
// 2026-11-12): a fixed, curated list, never free search. Nothing a person
// types goes to TMDB, and the app never calls TMDB's keyword search at
// runtime. A topic bundles TMDB keyword ids and matches a film with ANY of
// them (lib/constraints.ts); a film with no keywords at all fails closed
// for a hard limit.
//
// Compiled 2026-11-17 from the live TMDB API (GET /search/keyword with
// several terms per topic, then GET /keyword/{id}/movies for each
// candidate's total_results). Ids that were off-topic (e.g. "suicide
// bomber", "monty python", "miscarriage of justice") or used by fewer than
// 5 films were dropped. Each comment lists the kept ids, their TMDB names
// and film counts at compile time. "Flashing lights" was researched and
// left out: TMDB has no keyword for strobe effects (only "epilepsy", about
// the condition), so a limit on it would look protective and protect no
// one. Recompile the same way to add a topic; never at runtime.

export interface ContentTopic {
  slug: string;
  label: string;
  keywordIds: number[];
}

export const CONTENT_TOPICS: ContentTopic[] = [
  {
    slug: "suicide-self-harm",
    label: "Suicide and self-harm",
    // 236 suicide (1418), 1252 suicide attempt (326), 12364 mass suicide (20), 157791 self mutilation (28), 157800 cutting (7), 160035 suicide note (21), 171411 teen suicide (59), 233130 self-harm (93), 238304 suicide prevention (70), 273120 multiple suicide (5)
    keywordIds: [236, 1252, 12364, 157791, 157800, 160035, 171411, 233130, 238304, 273120],
  },
  {
    slug: "sexual-violence",
    label: "Sexual violence",
    // 570 rape (1177), 739 sexual abuse (257), 11262 statutory rape (16), 11527 rape victim (104), 11534 sexual violence (131), 12365 gang rape (64), 15241 teenage rape (14), 33739 molestation (24), 164263 marital rape (12), 165615 child molestation (20), 171219 rape accusation (18), 171662 date rape (12), 184988 childhood sexual abuse (44), 190327 sexual assault (229), 196399 rape revenge (63), 264551 child sexual abuse (101), 315583 male rape (13)
    keywordIds: [570, 739, 11262, 11527, 11534, 12365, 15241, 33739, 164263, 165615, 171219, 171662, 184988, 190327, 196399, 264551, 315583],
  },
  {
    slug: "animal-death-cruelty",
    label: "Animal death or cruelty",
    // 156456 animal abuse (38), 157164 animal death (18), 176661 death of pet (9), 205685 animal cruelty (60), 344244 cruelty to animals (6)
    keywordIds: [156456, 157164, 176661, 205685, 344244],
  },
  {
    slug: "child-abuse",
    label: "Child abuse",
    // 516 child abuse (385), 2337 pedophilia (105), 11161 paedophilia (11), 14576 pedophile (73), 165615 child molestation (20), 184988 childhood sexual abuse (44), 229809 female child abuser (9), 256570 abused child (39), 264551 child sexual abuse (101), 345081 abused as a child (7)
    keywordIds: [516, 2337, 11161, 14576, 165615, 184988, 229809, 256570, 264551, 345081],
  },
  {
    slug: "domestic-abuse",
    label: "Domestic abuse",
    // 10303 domestic abuse (207), 11925 domestic violence (324), 208363 spouse abuse (9), 212643 abusive husband (74), 228558 spousal abuse (25), 280688 abusive relationship (55)
    keywordIds: [10303, 11925, 208363, 212643, 228558, 280688],
  },
  {
    slug: "gore",
    label: "Gore",
    // 10292 gore (1136), 157444 dismemberment (58), 283085 body horror (506), 344603 splatter (77), 367142 gore fest (7), 373582 gore elements (7), 381001 extreme gore (17), 384154 splatter horror (50), 384156 blood and gore (41)
    keywordIds: [10292, 157444, 283085, 344603, 367142, 373582, 381001, 384154, 384156],
  },
  {
    slug: "torture",
    label: "Torture",
    // 10772 torture chamber (35), 13006 torture (614), 157714 sadistic torture (22), 159595 sexual torture (14), 172272 tortured to death (10), 175522 electrical torture (10), 193698 torture porn (27), 228164 torture victim (18)
    keywordIds: [10772, 13006, 157714, 159595, 172272, 175522, 193698, 228164],
  },
  {
    slug: "spiders",
    label: "Spiders",
    // 3888 giant spider (57), 3986 spider (117), 14792 tarantula (18), 158124 spider bite (8), 169909 spider web (15), 221272 arachnophobia (5), 235512 mutant spider (6), 320477 cartoon spider (12)
    keywordIds: [3888, 3986, 14792, 158124, 169909, 221272, 235512, 320477],
  },
  {
    slug: "snakes",
    label: "Snakes",
    // 1585 snake (206), 3496 snake charmer (11), 3891 giant snake (48), 33737 snake bite (20), 158241 killer snake (13), 166478 python (19), 191574 cobra (32), 215003 king cobra (9)
    keywordIds: [1585, 3496, 3891, 33737, 158241, 166478, 191574, 215003],
  },
  {
    slug: "needles",
    label: "Needles",
    // 3442 lethal injection (8), 4958 injection (13), 41308 syringe (14), 187544 needle (14)
    keywordIds: [3442, 4958, 41308, 187544],
  },
  {
    slug: "drug-use",
    label: "Drug use",
    // 726 drug abuse (285), 1803 drug addiction (543), 2150 cocaine (229), 2635 overdose (57), 2671 heroin (194), 9752 child on drugs (8), 10764 crack cocaine (27), 11494 drug use (168), 14964 drugs (1408), 41352 drug overdose (79), 156117 illegal drugs (139), 164877 heroin addict (52), 165423 prescription drug abuse (22), 176104 heroin addiction (52), 191979 anti drugs (35), 221561 psychotropic drugs (26), 223970 heroin withdrawl (8), 232037 high on drugs (10), 256284 recreational drug use (16), 299011 party drugs (8), 301542 drug usage (13), 359856 taking drugs (5)
    keywordIds: [726, 1803, 2150, 2635, 2671, 9752, 10764, 11494, 14964, 41352, 156117, 164877, 165423, 176104, 191979, 221561, 223970, 232037, 256284, 299011, 301542, 359856],
  },
  {
    slug: "eating-disorders",
    label: "Eating disorders",
    // 2324 bulimia (30), 6438 anorexia (84), 172383 eating disorder (106), 258066 anorexia nervosa (7), 369137 eating disorder recovery (5)
    keywordIds: [2324, 6438, 172383, 258066, 369137],
  },
  {
    slug: "pregnancy-loss",
    label: "Pregnancy loss and miscarriage",
    // 17986 miscarriage (64), 181232 still birth (6), 282261 stillbirth (8)
    keywordIds: [17986, 181232, 282261],
  },
  {
    slug: "claustrophobia",
    label: "Claustrophobia",
    // 2147 claustrophobia (50), 7172 buried alive (46), 18029 trapped (190), 185477 trapped underwater  (9), 190149 trapped in building (18), 191586 trapped in space (20), 194711 trapped in car (7), 207528 trapped underground (11), 227951 claustrophobic (45), 348145 confined spaces (6)
    keywordIds: [2147, 7172, 18029, 185477, 190149, 191586, 194711, 207528, 227951, 348145],
  },
  {
    slug: "vomiting",
    label: "Vomiting",
    // 5569 vomit (34), 163699 vomiting (25), 232071 vomiting woman (6)
    keywordIds: [5569, 163699, 232071],
  },
];
