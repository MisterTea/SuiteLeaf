/** What employee departure does today. Device names and tokens are not included. */

export type DepartureItem = {
  done: boolean;
  text: string;
};

const STEPS: DepartureItem[] = [
  { done: true, text: "A named device can be signed out. Other devices stay signed in." },
  { done: true, text: "One session can be asked to sign in again. The session row stays." },
  { done: true, text: "Removing the account can give their files to someone else." },
  { done: false, text: "This review does not remove the account or move any files." },
];

/** The device name is not copied into the notice or the steps. */
export function departureChecklist(device: string): { notice: string; steps: DepartureItem[] } {
  if (!device.trim()) {
    return { notice: "Name the device to sign out.", steps: STEPS };
  }
  return {
    notice: "The named device can be signed out. This note does not include the device name.",
    steps: STEPS,
  };
}
