import type { KmsDocument, KmsMatch, KmsRetrieval } from "./kms";

const IGNORED_WORDS = new Set([
  "about", "after", "again", "available", "could", "data", "document", "documents",
  "from", "give", "have", "into", "last", "month", "please", "show", "some",
  "team", "that", "them", "there", "these", "this", "what", "when", "where",
  "which", "with", "would", "your",
]);
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

type CatalogDocument = KmsDocument & {
  department?: string | null;
  uploaded_at?: string | null;
};

export type FuzzyDocumentCandidate = {
  document: KmsDocument;
  matchedTypo: { queryTerm: string; titleTerm: string };
  score: number;
};

function tokens(value: string) {
  return value.toLowerCase().match(/[a-z]+|\d+/g) || [];
}

function editDistance(left: string, right: string) {
  const rows = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i++) rows[i][0] = i;
  for (let j = 0; j <= right.length; j++) rows[0][j] = j;
  for (let i = 1; i <= left.length; i++) for (let j = 1; j <= right.length; j++) {
    rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + Number(left[i - 1] !== right[j - 1]));
    if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
      rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[left.length][right.length];
}

function previousMonth(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", month: "numeric" }).formatToParts(now);
  const current = Number(parts.find((part) => part.type === "month")?.value);
  return MONTHS[(current + 10) % 12];
}

function catalogTerms(document: CatalogDocument) {
  const title = tokens(document.file_name || document.dropbox_path?.split("/").pop() || "");
  const path = tokens(document.dropbox_path?.split("/").slice(0, -1).join("/") || "");
  const metadata = tokens([document.department, document.owner_name, document.uploaded_by].filter(Boolean).join(" "));
  const acronyms = new Set<string>();
  for (const words of [title, path, metadata]) {
    for (let i = 0; i < words.length - 1; i++) acronyms.add(words[i][0] + words[i + 1][0]);
  }
  return { title: new Set(title), all: new Set([...title, ...path, ...metadata]), acronyms };
}

function sameSource(left: { file_name?: string; dropbox_path?: string }, right: { file_name?: string; dropbox_path?: string }) {
  const leftPath = left.dropbox_path?.replaceAll("\\", "/").toLowerCase();
  const rightPath = right.dropbox_path?.replaceAll("\\", "/").toLowerCase();
  if (leftPath && rightPath) return leftPath === rightPath;
  return Boolean(left.file_name && right.file_name && left.file_name.toLowerCase() === right.file_name.toLowerCase());
}

/** Match likely typos against the indexed catalog; never rewrite the user's query or names. */
export function findFuzzyDocumentCandidate(query: string, documents: KmsDocument[], now = new Date()): FuzzyDocumentCandidate | null {
  if (!documents.length) return null;
  const wordMatches = [...query.matchAll(/[A-Za-z]{5,}/g)].map((match) => ({ word: match[0], index: match.index }));
  const catalog = documents.map((document) => ({ document, terms: catalogTerms(document as CatalogDocument) }));
  const vocabulary = new Set(catalog.flatMap(({ terms }) => [...terms.title].filter((term) => term.length >= 5 && !IGNORED_WORDS.has(term))));
  const typoMatches = wordMatches.flatMap(({ word, index }) => {
    const lower = word.toLowerCase();
    // Acronyms, mixed-case product names, and already indexed names stay literal.
    // An initial capital on the first word is ordinary sentence casing.
    if ((word !== lower && !(index === 0 && word === word[0].toUpperCase() + lower.slice(1)))
      || IGNORED_WORDS.has(lower) || vocabulary.has(lower)) return [];
    const nearest = [...vocabulary].map((term) => ({ term, distance: editDistance(lower, term) }))
      .filter(({ distance }) => distance <= (lower.length >= 7 ? 2 : 1))
      .sort((left, right) => left.distance - right.distance);
    if (!nearest.length || (nearest[1] && nearest[0].distance === nearest[1].distance)) return [];
    return [{ queryTerm: word, titleTerm: nearest[0].term }];
  });
  if (!typoMatches.length) return null;

  const queryTerms = new Set(tokens(query).filter((term) => term.length >= 4 && !IGNORED_WORDS.has(term)));
  const queryAcronyms = new Set((query.match(/\b[A-Z]{2,}\b/g) || []).map((term) => term.toLowerCase()));
  const month = /\blast month\b/i.test(query) ? previousMonth(now) : null;
  const ranked = catalog.map(({ document, terms }) => {
    const typos = typoMatches.filter(({ titleTerm }) => terms.title.has(titleTerm));
    const exact = [...queryTerms].filter((term) => terms.all.has(term)).length;
    const acronym = [...queryAcronyms].filter((term) => terms.all.has(term) || terms.acronyms.has(term)).length;
    const monthMatch = month && terms.title.has(month) ? 1 : 0;
    const titleMonths = MONTHS.filter((name) => terms.title.has(name));
    return { document, typo: typos[0], anchored: exact + acronym + monthMatch > 0, titleMonths, score: typos.length * 3 + exact + acronym + monthMatch * 2 };
  }).filter((candidate) => {
    if (!candidate.typo || !candidate.anchored) return false;
    return !month || !candidate.titleMonths.length || candidate.titleMonths.includes(month);
  })
    .sort((left, right) => right.score - left.score);
  if (!ranked.length || ranked[0].score < 4 || (ranked[1] && ranked[0].score - ranked[1].score < 2)) return null;
  return { document: ranked[0].document, matchedTypo: ranked[0].typo, score: ranked[0].score };
}

/** Supplement the unchanged first search with an exact-title lookup only for a strong catalog match. */
export async function addFuzzyTitleLookup(
  query: string,
  original: KmsRetrieval,
  retrieve: (question: string) => Promise<KmsRetrieval>,
  now = new Date(),
): Promise<{ retrieval: KmsRetrieval; candidate: FuzzyDocumentCandidate | null }> {
  const candidate = findFuzzyDocumentCandidate(query, original.documents || [], now);
  if (!candidate) return { retrieval: original, candidate: null };
  const title = candidate.document.file_name || candidate.document.dropbox_path?.split("/").pop();
  if (!title) return { retrieval: original, candidate: null };
  try {
    const supplemental = await retrieve(title);
    const matches = (supplemental.matches || []).filter((match: KmsMatch) => sameSource(match, candidate.document) && match.text?.trim());
    if (!matches.length) return { retrieval: original, candidate: null };
    return { retrieval: { ...original, matches: matches.slice(0, 5) }, candidate };
  } catch {
    return { retrieval: original, candidate: null };
  }
}
