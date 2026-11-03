import { useState } from "react";
import { departureChecklist } from "@suiteleaf/core";

/** What departure does. The status does not include the device name. */
export function DepartureNote() {
  const [device, setDevice] = useState("");
  const [notice, setNotice] = useState("");
  const steps = departureChecklist(device).steps;
  return (
    <section className="access-notes" aria-label="Employee departure">
      <h2>Employee departure</h2>
      <ul>
        {steps.map((step) => (
          <li key={step.text}>{step.done ? "Done. " : "Not done. "}{step.text}</li>
        ))}
      </ul>
      <label>
        Device
        <input
          aria-label="Departure device"
          value={device}
          onChange={(event) => setDevice(event.target.value)}
        />
      </label>
      <button type="button" onClick={() => setNotice(departureChecklist(device).notice)}>
        Review departure
      </button>
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
