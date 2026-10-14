import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import {
  drive,
  getSession,
  type AccessGrant,
  type AccountProfile,
  type ItemAccess,
} from "../node-client";
import { ExpiryCalendar } from "./ExpiryCalendar";
import { endedPhrase, untilPhrase } from "./share-expiry";
import {
  GRANT_ROLES,
  asGrantRole,
  defaultGrantRole,
  grantRolesFor,
  roleDescription,
  roleVerb,
  type GrantRole,
  type GrantRoleOption,
} from "./roles";

const UNDO_MS = 8000;

type Target = { id: string; name: string };

function personLabel(person: {
  name: string | null;
  email: string | null;
  principalId?: string;
  id?: string;
}) {
  return person.name || person.email || person.principalId || person.id || "Someone";
}

function givenName(person: {
  name: string | null;
  email: string | null;
  principalId?: string;
  id?: string;
}) {
  const full = personLabel(person);
  return full.includes("@") ? full : (full.split(" ")[0] ?? full);
}

/** Choose a role. The current role, and what it means, stay visible before the menu opens. */
function RoleMenu({
  roles,
  value,
  label,
  allowRemove = false,
  disabled = false,
  extras = [],
  detail,
  onChange,
}: {
  roles: readonly GrantRoleOption[];
  value: GrantRole;
  label: string;
  allowRemove?: boolean;
  disabled?: boolean;
  extras?: { label: string; description: string; onPick: () => void }[];
  /** Replaces the role description, for example "until Saturday". */
  detail?: string;
  onChange: (next: GrantRole | "remove") => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="share-role" ref={root}>
      <button
        type="button"
        className="share-role-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{GRANT_ROLES.find((r) => r.id === value)?.name}</span>
        <small>{detail || roleDescription(value)}</small>
      </button>
      {open ? (
        <ul className="share-role-menu" role="listbox" aria-label={label}>
          {roles.map((role) => (
            <li key={role.id}>
              <button
                type="button"
                role="option"
                aria-selected={role.id === value}
                onClick={() => {
                  setOpen(false);
                  if (role.id !== value) onChange(role.id);
                }}
              >
                <span>{role.name}</span>
                <small>{role.description}</small>
                {role.id === value ? <Check size={14} /> : null}
              </button>
            </li>
          ))}
          {extras.map((extra) => (
            <li key={extra.label}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  extra.onPick();
                }}
              >
                <span>{extra.label}</span>
                <small>{extra.description}</small>
              </button>
            </li>
          ))}
          {allowRemove ? (
            <li>
              <button
                type="button"
                className="share-remove"
                onClick={() => {
                  setOpen(false);
                  onChange("remove");
                }}
              >
                Remove access
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Share a SuiteDrive file or folder with people who have accounts on this
 * server. Changes save as soon as a role is chosen; there is no separate Save.
 */
export function ShareDialog({
  itemId,
  itemName,
  kind,
  onClose,
}: {
  itemId: string;
  itemName: string;
  kind: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const [target, setTarget] = useState<Target>({ id: itemId, name: itemName });
  const [back, setBack] = useState<Target | null>(null);
  const [access, setAccess] = useState<ItemAccess | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<AccountProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState("");
  const [picked, setPicked] = useState<AccountProfile | null>(null);
  const [grantRole, setGrantRole] = useState<GrantRole>(defaultGrantRole(kind));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<{
    person: AccessGrant;
    until: number;
  } | null>(null);
  const [handover, setHandover] = useState<AccessGrant | null>(null);
  const [expiring, setExpiring] = useState<AccessGrant | null>(null);
  const listRef = useRef(0);
  const you = getSession()?.user.id ?? "";
  const sharingForm = kind === "form" && target.id === itemId;
  const roles = grantRolesFor(sharingForm ? "form" : "other");
  const defaultRole = defaultGrantRole(sharingForm ? "form" : "other");

  const load = async (id: string) => {
    const n = ++listRef.current;
    try {
      const next = await drive.access(id);
      if (n === listRef.current) {
        setAccess(next);
        setError("");
      }
    } catch (e) {
      if (n === listRef.current)
        setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load(target.id);
  }, [target.id]);

  useEffect(() => {
    if (!undo) return;
    const left = undo.until - Date.now();
    const timer = setTimeout(() => setUndo(null), Math.max(left, 0));
    return () => clearTimeout(timer);
  }, [undo]);

  useEffect(() => {
    const text = query.trim();
    if (picked || text.length < 2) {
      setMatches([]);
      setSearched("");
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void drive
        .accounts(text)
        .then((found) => {
          setMatches(found);
          setSearched(text);
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setSearching(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [query, picked]);

  const canManage = access?.yourRole === "owner";
  const accessNote =
    access?.yourRole === "editor"
      ? "You can edit this file. Only the owner can change who has access."
      : access?.yourRole === "responder"
        ? "You can sign up on this form. Only the owner can change who has access."
        : access?.yourRole === "commenter"
          ? "You can comment on this file. Only the owner can change who has access."
          : access?.yourRole === "viewer"
            ? "You can view this file. Only the owner can change who has access."
            : "Only the owner can change who has access.";
  const unknown =
    !picked &&
    searched.includes("@") &&
    !searching &&
    query.trim() === searched &&
    matches.length === 0
      ? `No account on this server uses ${searched}. Ask them to sign up first.`
      : !picked &&
          searched &&
          !searched.includes("@") &&
          !searching &&
          query.trim() === searched &&
          matches.length === 0
        ? `No account on this server matches “${searched}”.`
        : "";

  const apply = async (work: () => Promise<void>, said: string) => {
    setBusy(true);
    setNotice("");
    try {
      await work();
      setNotice(said);
      await load(target.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const grant = () => {
    if (!picked) return;
    const person = picked;
    const role = grantRole;
    void apply(async () => {
      await drive.share(target.id, person.id, role);
      setPicked(null);
      setQuery("");
      setGrantRole(defaultRole);
    }, `${givenName(person)} can now ${roleVerb(role)}`);
  };

  const changeRole = (person: AccessGrant, role: GrantRole) => {
    const name = givenName(person);
    void apply(
      () => drive.share(target.id, person.principalId, role),
      `${name} can now ${roleVerb(role)}`,
    );
  };

  const remove = (person: AccessGrant) => {
    const name = personLabel(person);
    void apply(async () => {
      await drive.share(target.id, person.principalId, null);
      setUndo({ person, until: Date.now() + UNDO_MS });
    }, `${name} no longer has access`);
  };

  const confirmHandover = () => {
    if (!handover) return;
    const person = handover;
    setHandover(null);
    void apply(
      () => drive.transfer(target.id, person.principalId),
      `${personLabel(person)} owns this file now`,
    );
  };

  const pickExpiry = (iso: string) => {
    if (!expiring) return;
    const person = expiring;
    setExpiring(null);
    const when = untilPhrase(iso).replace(/^until /, "");
    void apply(
      () => drive.expire(target.id, person.principalId, iso),
      `${givenName(person)}'s access ends ${when}`,
    );
  };

  const restore = () => {
    if (!undo || undo.person.role === "owner") return;
    const person = undo.person;
    setUndo(null);
    void apply(
      () =>
        drive.share(
          target.id,
          person.principalId,
          person.role === "owner" ? "editor" : person.role,
        ),
      `${personLabel(person)} has access again`,
    );
  };

  const openFolder = () => {
    if (!access?.parent) return;
    setBack(target);
    setTarget(access.parent);
    setPicked(null);
    setQuery("");
    setNotice("");
    setUndo(null);
    setHandover(null);
    setExpiring(null);
  };

  return createPortal(
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="gdocs-dialog share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 id={titleId}>Share “{target.name}”</h2>
          <button
            type="button"
            className="dialog-close-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {error ? (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        {canManage ? (
          <div className="share-add">
            <label htmlFor="share-people">Add people</label>
            <input
              id="share-people"
              autoFocus
              placeholder="Name or email"
              autoComplete="off"
              aria-autocomplete="list"
              aria-controls="share-suggestions"
              value={picked ? personLabel(picked) : query}
              onChange={(e) => {
                setPicked(null);
                setQuery(e.target.value);
                setNotice("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches[0] && !picked) {
                  e.preventDefault();
                  setPicked(matches[0]);
                  setGrantRole(defaultRole);
                }
              }}
            />
            {matches.length > 0 && !picked ? (
              <ul id="share-suggestions" className="share-suggestions" role="listbox">
                {matches.map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      role="option"
                      onClick={() => {
                        setPicked(person);
                        setGrantRole(defaultRole);
                      }}
                    >
                      <strong>{person.name || person.email}</strong>
                      <small>
                        {person.email}
                        {person.username ? ` · ${person.username}` : ""}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {unknown ? (
              <p className="share-miss" role="alert">
                {unknown}
              </p>
            ) : null}
            {picked ? (
              <div className="share-pending">
                <RoleMenu
                  roles={roles}
                  value={grantRole}
                  label={`Role for ${personLabel(picked)}`}
                  onChange={(next) => {
                    if (next !== "remove") setGrantRole(next);
                  }}
                />
                <button
                  type="button"
                  className="dialog-primary-btn"
                  disabled={busy}
                  onClick={grant}
                >
                  Share
                </button>
              </div>
            ) : unknown ? (
              <button type="button" className="dialog-primary-btn" disabled>
                Share
              </button>
            ) : null}
          </div>
        ) : access ? (
          <p className="dialog-note">{accessNote}</p>
        ) : null}
        {handover ? (
          <div className="share-confirm" role="group" aria-label="Hand over this file">
            <p>
              Make {personLabel(handover)} the owner? You will become an editor.
            </p>
            <div>
              <button type="button" onClick={() => setHandover(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="dialog-primary-btn"
                disabled={busy}
                onClick={confirmHandover}
              >
                Make owner
              </button>
            </div>
          </div>
        ) : null}
        {expiring ? (
          <ExpiryCalendar
            person={personLabel(expiring)}
            onPick={pickExpiry}
            onClose={() => setExpiring(null)}
          />
        ) : null}
        <h3 className="share-list-title">People with access</h3>
        {access ? null : <p className="share-private">Loading…</p>}
        <ul className="share-people">
          {(access?.grants ?? []).map((person) => {
            const yours = person.principalId === you;
            const inherited = person.inheritedFrom;
            const roleName =
              GRANT_ROLES.find((r) => r.id === person.role)?.name ?? person.role;
            const ended = person.expired && person.expiresAt;
            const manageable =
              canManage &&
              person.principalType !== "owner" &&
              person.role !== "owner" &&
              !inherited &&
              !ended;
            const when =
              person.expiresAt && !person.expired
                ? `${roleName} · ${untilPhrase(person.expiresAt)}`
                : ended
                  ? endedPhrase(person.expiresAt!)
                  : "";
            return (
              <li key={`${person.principalType}:${person.principalId}`}>
                <div>
                  <strong>
                    {personLabel(person)}
                    {yours ? " (you)" : ""}
                  </strong>
                  {person.email ? <small>{person.email}</small> : null}
                  {when ? <small className="share-until">{when}</small> : null}
                  {inherited ? (
                    <small className="share-via">from {inherited.name}</small>
                  ) : null}
                </div>
                {person.principalType === "owner" || person.role === "owner" ? (
                  <span className="share-owner">Owner</span>
                ) : ended && canManage && !inherited ? (
                  <button
                    type="button"
                    className="share-remove-btn"
                    disabled={busy}
                    onClick={() => remove(person)}
                  >
                    Remove
                  </button>
                ) : manageable ? (
                  <RoleMenu
                    roles={roles}
                    value={asGrantRole(person.role)}
                    label={`Role for ${personLabel(person)}`}
                    allowRemove
                    disabled={busy}
                    detail={
                      person.expiresAt && !person.expired
                        ? untilPhrase(person.expiresAt)
                        : undefined
                    }
                    extras={
                      person.principalType === "user"
                        ? [
                            {
                              label: "Make owner",
                              description: "They own it immediately",
                              onPick: () => {
                                setExpiring(null);
                                setHandover(person);
                              },
                            },
                            {
                              label: "Access expires",
                              description: "Pick the day it ends",
                              onPick: () => {
                                setHandover(null);
                                setExpiring(person);
                              },
                            },
                          ]
                        : []
                    }
                    onChange={(next) =>
                      next === "remove" ? remove(person) : changeRole(person, next)
                    }
                  />
                ) : (
                  <span className="share-owner">{roleName}</span>
                )}
              </li>
            );
          })}
        </ul>
        {access ? (
          <p className="share-private">
            Only the people listed here can open this file.
          </p>
        ) : null}
        {notice ? (
          <p className="share-notice" role="status">
            {notice}
            {undo ? (
              <button type="button" onClick={restore}>
                Undo
              </button>
            ) : null}
          </p>
        ) : null}
        {access?.parent && !back ? (
          <p className="share-folder">
            This file is in {access.parent.name}.{" "}
            <button type="button" onClick={openFolder}>
              Share “{access.parent.name}”
            </button>
          </p>
        ) : null}
        {back ? (
          <p className="share-folder">
            <button
              type="button"
              onClick={() => {
                setTarget(back);
                setBack(null);
                setPicked(null);
                setQuery("");
                setNotice("");
                setUndo(null);
                setHandover(null);
                setExpiring(null);
              }}
            >
              Back to “{back.name}”
            </button>
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
