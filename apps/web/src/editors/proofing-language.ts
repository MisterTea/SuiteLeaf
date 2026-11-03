/** Languages the spelling dialog can store on a document. Only English has a local word list. */
export const PROOFING_LANGUAGES = [
  { id: "en", label: "English" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
  { id: "ar", label: "Arabic" },
  { id: "he", label: "Hebrew" },
] as const;

export type ProofingLanguage = (typeof PROOFING_LANGUAGES)[number]["id"];

export function proofingLanguage(value: unknown): ProofingLanguage {
  return PROOFING_LANGUAGES.some((item) => item.id === value) ? (value as ProofingLanguage) : "en";
}

/** English uses the dictionary on this computer. Another language is not compared with those English words. */
export function checksEnglishSpelling(language: ProofingLanguage): boolean {
  return language === "en";
}

/** Arabic and Hebrew are written from right to left. The other proofing languages stay left to right. */
export function proofingTextDirection(language: ProofingLanguage): "ltr" | "rtl" {
  return language === "ar" || language === "he" ? "rtl" : "ltr";
}

export function spellingLanguageNote(language: ProofingLanguage): string {
  if (language === "en")
    return "Spelling uses the English dictionary on this computer. The text is not sent to a spelling service.";
  const label = PROOFING_LANGUAGES.find((item) => item.id === language)?.label ?? "This language";
  const direction =
    proofingTextDirection(language) === "rtl" ? " The document is written from right to left." : "";
  return `${label} is not checked against the English dictionary. The text is not sent to a spelling service. A word you flag is still underlined.${direction}`;
}
