import type { FilePresence } from "../node-client";

/** How another person is shown. Idle wins over editing or viewing. */
export function presenceLabel(person: FilePresence): string {
  const state = person.idle ? "idle" : person.editing ? "editing" : "viewing";
  const name = person.name.replace(/\s+/g, " ").trim();
  if (!name) return `Someone is ${state}`;
  return `${name} is ${state}`;
}
