declare module "dictionary-en-files/*?raw" {
  const text: string;
  export default text;
}
interface ImportMetaEnv {
  readonly VITE_SUITELEAF_DEMO?: string;
  readonly VITE_SUITELEAF_FORMS?: string;
  readonly VITE_SUITELEAF_MODEL_HOST?: string;
  readonly VITE_SUITELEAF_CAST_APP_ID?: string;
}
