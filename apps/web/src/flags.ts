/**
 * Forms stay in the file format. Home, menus, and the library hide them
 * until a build sets `VITE_SUITELEAF_FORMS=1`.
 */
export const formsEnabled = import.meta.env.VITE_SUITELEAF_FORMS === "1";
