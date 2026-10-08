import "./office-password.css";
/** A transient, masked password request. Nothing is saved to application storage. */
export function requestOfficePassword(
  filename: string,
  retry: boolean,
): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "office-password-dialog";
    dialog.setAttribute("aria-labelledby", "office-password-title");
    const form = document.createElement("form");
    const title = document.createElement("h2");
    title.id = "office-password-title";
    title.textContent = "Open password-protected file";
    const description = document.createElement("p");
    description.textContent = filename;
    const error = document.createElement("p");
    error.setAttribute("role", "status");
    error.textContent = retry
      ? "The password is incorrect. Try again."
      : "Enter the password used to protect this file.";
    const label = document.createElement("label");
    label.textContent = "Password";
    const input = document.createElement("input");
    input.type = "password";
    input.autocomplete = "off";
    input.id = "office-password-input";
    label.htmlFor = input.id;
    const actions = document.createElement("div");
    actions.className = "office-password-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Open file";
    actions.append(cancel, submit);
    form.append(title, description, error, label, input, actions);
    dialog.append(form);
    document.body.append(dialog);
    let finished = false;
    const finish = (value: string | null) => {
      if (finished) return;
      finished = true;
      input.value = "";
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      finish(input.value);
    });
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.showModal();
    input.focus();
  });
}
