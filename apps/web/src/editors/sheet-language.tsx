import {
  PROOFING_LANGUAGES,
  proofingLanguage,
  proofingTextDirection,
  spellingLanguageNote,
  type ProofingLanguage,
} from "./proofing-language";

/** Stores the spreadsheet's proofing language. Spelling is checked by the caller. */
export function SheetLanguageField({
  language,
  onChange,
}: {
  language: ProofingLanguage;
  onChange: (language: ProofingLanguage) => void;
}) {
  return (
    <section className="access-notes" aria-label="Proofing language" dir={proofingTextDirection(language)}>
      <h2>Proofing language</h2>
      <label>
        Language
        <select
          aria-label="Proofing language"
          value={language}
          onChange={(event) => onChange(proofingLanguage(event.target.value))}
        >
          {PROOFING_LANGUAGES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <p>{spellingLanguageNote(language)}</p>
    </section>
  );
}
