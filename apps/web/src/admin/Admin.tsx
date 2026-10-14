import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { CycleNotice, DocumentTrail } from "./admin-view";
import { useMode } from "../mode";
import { useNodeSession } from "../drive/SignIn";
import {
  adminApi,
  currentAccount,
  type AdminGroup,
  type AdminGroupDetail,
  type AdminPerson,
  type AdminUser,
} from "../node-client";
import {
  adminDestination,
  formatBytes,
  isAdminRole,
  signInRows,
} from "./admin-model";
import "./admin.css";

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export { AdminLink } from "./admin-view";

export function AdminScreen() {
  const { mode } = useMode();
  const session = useNodeSession();
  const cluster = mode.kind === "cluster";
  const [role, setRole] = useState(session?.user.role);
  const [checked, setChecked] = useState(isAdminRole(session?.user.role));
  useEffect(() => {
    if (!cluster) return;
    let gone = false;
    void currentAccount()
      .then((user) => {
        if (gone) return;
        setRole(user.role);
        setChecked(true);
      })
      .catch(() => {
        if (!gone) setChecked(true);
      });
    return () => {
      gone = true;
    };
  }, [cluster]);
  if (!checked && cluster && !isAdminRole(session?.user.role)) {
    return <p className="loading">Opening Admin…</p>;
  }
  const where = adminDestination(cluster, role ?? session?.user.role);
  if (where === "home") return <Navigate to="/" replace />;
  if (where === "denied") {
    return (
      <main className="admin-page">
        <div className="admin-bar">
          <h1>Admin</h1>
          <Link to="/">Back to files</Link>
        </div>
        <div className="admin-main">
          <p>You do not have access to Admin.</p>
        </div>
      </main>
    );
  }
  return <AdminApp />;
}

function AdminApp() {
  const [tab, setTab] = useState<"people" | "groups">("people");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [personId, setPersonId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const reload = async () => {
    const [nextUsers, nextGroups] = await Promise.all([
      adminApi.users(),
      adminApi.groups(),
    ]);
    setUsers(nextUsers);
    setGroups(nextGroups);
  };
  useEffect(() => {
    void reload().catch((e) => setError(message(e)));
  }, []);
  return (
    <div className="admin-page">
      <header className="admin-bar">
        <h1>Admin</h1>
        <nav className="admin-tabs" aria-label="Admin">
          <button
            type="button"
            aria-selected={tab === "people"}
            onClick={() => {
              setTab("people");
              setPersonId(null);
            }}
          >
            People
          </button>
          <button
            type="button"
            aria-selected={tab === "groups"}
            onClick={() => {
              setTab("groups");
              setGroupId(null);
            }}
          >
            Groups
          </button>
        </nav>
        <Link to="/">Back to files</Link>
      </header>
      <main className="admin-main">
        <CycleNotice message={error} />
        {tab === "people" ? (
          personId ? (
            <PersonPage
              id={personId}
              users={users}
              onBack={() => setPersonId(null)}
              onChanged={() => void reload().catch((e) => setError(message(e)))}
              onRemoved={() => {
                setPersonId(null);
                void reload().catch((e) => setError(message(e)));
              }}
            />
          ) : (
            <PeopleList
              users={users}
              groups={groups}
              onOpen={setPersonId}
              onCreated={() => void reload().catch((e) => setError(message(e)))}
              onError={setError}
            />
          )
        ) : groupId ? (
          <GroupPage
            id={groupId}
            users={users}
            groups={groups}
            onBack={() => setGroupId(null)}
            onChanged={() => void reload().catch((e) => setError(message(e)))}
            onRemoved={() => {
              setGroupId(null);
              void reload().catch((e) => setError(message(e)));
            }}
          />
        ) : (
          <GroupList
            groups={groups}
            onOpen={setGroupId}
            onCreated={() => void reload().catch((e) => setError(message(e)))}
            onError={setError}
          />
        )}
      </main>
    </div>
  );
}

function PeopleList({
  users,
  groups,
  onOpen,
  onCreated,
  onError,
}: {
  users: AdminUser[];
  groups: AdminGroup[];
  onOpen: (id: string) => void;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [listed, setListed] = useState(users);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [admin, setAdmin] = useState(false);
  useEffect(() => setListed(users), [users]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void adminApi
        .users(query, group)
        .then(setListed)
        .catch((e) => onError(message(e)));
    }, 200);
    return () => clearTimeout(timer);
  }, [query, group, users, onError]);
  return (
    <>
      <form
        className="admin-form"
        onSubmit={(event) => {
          event.preventDefault();
          void adminApi
            .createUser({ name, email, password, admin })
            .then(() => {
              setName("");
              setEmail("");
              setPassword("");
              setAdmin(false);
              onCreated();
            })
            .catch((e) => onError(message(e)));
        }}
      >
        <h2>New account</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={admin}
            onChange={(e) => setAdmin(e.target.checked)}
          />{" "}
          Admin
        </label>
        <button className="admin-primary" type="submit">
          Create account
        </button>
      </form>
      <div className="admin-inline">
        <label>
          Search people
          <input
            aria-label="Search people"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          Filter by group
          <select
            aria-label="Filter by group"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="">Everyone</option>
            {groups.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="admin-list" aria-label="People">
        {listed.map((person) => (
          <li key={person.id}>
            <button type="button" onClick={() => onOpen(person.id)}>
              {person.name || person.email}
            </button>
            <small className="admin-muted">
              {isAdminRole(person.role) ? "Admin" : "User"}
              {person.banned ? " · Disabled" : ""}
              {person.groups?.length ? ` · ${person.groups.join(", ")}` : ""}
            </small>
          </li>
        ))}
      </ul>
    </>
  );
}

function PersonPage({
  id,
  users,
  onBack,
  onChanged,
  onRemoved,
}: {
  id: string;
  users: AdminUser[];
  onBack: () => void;
  onChanged: () => void;
  onRemoved: () => void;
}) {
  const [person, setPerson] = useState<AdminPerson | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const load = () =>
    adminApi.user(id).then((next) => {
      setPerson(next);
      setName(next.user.name ?? "");
      setEmail(next.user.email ?? "");
      setError("");
    });
  useEffect(() => {
    void load().catch((e) => setError(message(e)));
  }, [id]);
  if (!person) {
    return (
      <>
        <CycleNotice message={error} />
        <p>Loading…</p>
      </>
    );
  }
  const signs = signInRows(person.sessions, person.signIns);
  const run = (work: () => Promise<unknown>) =>
    void work()
      .then(() => load())
      .then(onChanged)
      .catch((e) => setError(message(e)));
  return (
    <>
      <button type="button" className="admin-back" onClick={onBack}>
        All people
      </button>
      <h2>{person.user.name || person.user.email}</h2>
      <CycleNotice message={error} />
      <form
        className="admin-form"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => adminApi.updateUser(id, { name, email }));
        }}
      >
        <label>
          Name
          <input aria-label="Person name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Email
          <input aria-label="Person email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button type="submit">Save person</button>
      </form>
      <div className="admin-actions">
        <label>
          Role
          <select
            aria-label="Role"
            value={isAdminRole(person.user.role) ? "admin" : "user"}
            onChange={(e) =>
              run(() => adminApi.setRole(id, e.target.value === "admin" ? "admin" : "user"))
            }
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => run(() => adminApi.setBanned(id, !person.user.banned))}
        >
          {person.user.banned ? "Enable" : "Disable"}
        </button>
        <button type="button" onClick={() => run(() => adminApi.revokeSessions(id))}>
          Sign out everywhere
        </button>
      </div>
      <form
        className="admin-form"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => adminApi.setPassword(id, password).then(() => setPassword("")));
        }}
      >
        <label>
          New password
          <input
            aria-label="New password"
            type="password"
            value={password}
            minLength={8}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit">Set password</button>
        <p className="admin-muted">Setting a password also signs them out everywhere.</p>
      </form>
      <section className="admin-card">
        <h3>Documents</h3>
        <DocumentTrail entries={person.documents} />
      </section>
      <section className="admin-card">
        <h3>Sign-ins</h3>
        {signs.length === 0 ? (
          <p>No sign-ins recorded.</p>
        ) : (
          <ul className="admin-list" aria-label="Sign-ins">
            {signs.map((row) => (
              <li key={row.id}>
                <span>{row.at}</span>
                <small className="admin-muted">{row.detail}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="admin-card">
        <h3>Files</h3>
        <p>Using {formatBytes(person.bytes)}.</p>
        <ul className="admin-list" aria-label="Files">
          {person.files.map((file) => (
            <li key={file.id}>
              <span>{file.name}</span>
              <small className="admin-muted">
                {file.via === "owned" ? "Owns" : `Via ${file.groupName ?? "a group"}`}
                {" · "}
                {formatBytes(file.size)}
              </small>
            </li>
          ))}
        </ul>
      </section>
      <section className="admin-card">
        <h3>Groups</h3>
        <ul className="admin-list">
          {person.groups.map((group) => (
            <li key={group.id}>
              <span>{group.name}</span>
              <small className="admin-muted">
                {person.directGroupIds.includes(group.id) ? "Direct" : "Through another group"}
              </small>
            </li>
          ))}
        </ul>
      </section>
      <section className="admin-card">
        <h3>Admin changes</h3>
        {person.changes.length === 0 ? (
          <p>No admin changes yet.</p>
        ) : (
          <ul className="admin-list" aria-label="Admin changes">
            {person.changes.map((change) => (
              <li key={change.id}>
                <span>
                  {change.action}
                  {change.name ? ` · ${change.name}` : ""}
                </span>
                <small className="admin-muted">{change.at}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
      <form
        className="admin-form"
        onSubmit={(event) => {
          event.preventDefault();
          void adminApi
            .removeUser(id, ownerId || undefined)
            .then(onRemoved)
            .catch((e) => setError(message(e)));
        }}
      >
        <h3>Remove account</h3>
        {person.files.some((file) => file.via === "owned") ? (
          <label>
            Who should own their files
            <select
              aria-label="Who should own their files"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              required
            >
              <option value="">Choose a person</option>
              {users
                .filter((user) => user.id !== id)
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name || user.email}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        <button type="submit">Remove account</button>
      </form>
    </>
  );
}

function GroupList({
  groups,
  onOpen,
  onCreated,
  onError,
}: {
  groups: AdminGroup[];
  onOpen: (id: string) => void;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <>
      <form
        className="admin-form"
        onSubmit={(event) => {
          event.preventDefault();
          void adminApi
            .createGroup(name)
            .then(() => {
              setName("");
              onCreated();
            })
            .catch((e) => onError(message(e)));
        }}
      >
        <label>
          New group
          <input
            aria-label="New group"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <button className="admin-primary" type="submit">
          Create group
        </button>
      </form>
      <ul className="admin-list" aria-label="Groups">
        {groups.map((group) => (
          <li key={group.id}>
            <button type="button" onClick={() => onOpen(group.id)}>
              {group.name}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function GroupPage({
  id,
  users,
  groups,
  onBack,
  onChanged,
  onRemoved,
}: {
  id: string;
  users: AdminUser[];
  groups: AdminGroup[];
  onBack: () => void;
  onChanged: () => void;
  onRemoved: () => void;
}) {
  const [detail, setDetail] = useState<AdminGroupDetail | null>(null);
  const [name, setName] = useState("");
  const [personId, setPersonId] = useState("");
  const [childId, setChildId] = useState("");
  const [error, setError] = useState("");
  const load = () =>
    adminApi.group(id).then((next) => {
      setDetail(next);
      setName(next.group.name);
    });
  useEffect(() => {
    void load().catch((e) => setError(message(e)));
  }, [id]);
  if (!detail) {
    return (
      <>
        <CycleNotice message={error} />
        <p>Loading…</p>
      </>
    );
  }
  const names = new Map(users.map((user) => [user.id, user.name || user.email || user.id]));
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const run = (work: () => Promise<unknown>) =>
    void work()
      .then(() => load())
      .then(onChanged)
      .catch((e) => setError(message(e)));
  return (
    <>
      <button type="button" className="admin-back" onClick={onBack}>
        All groups
      </button>
      <h2>{detail.group.name}</h2>
      {detail.loopPresent ? (
        <CycleNotice message="This group contains a loop. Remove one membership to break it." />
      ) : null}
      <CycleNotice message={error} />
      <form
        className="admin-form"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => adminApi.renameGroup(id, name));
        }}
      >
        <label>
          Group name
          <input aria-label="Group name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit">Rename group</button>
      </form>
      <section className="admin-card">
        <h3>Members</h3>
        <ul className="admin-list" aria-label="Members">
          {detail.members.map((member) => (
            <li key={`${member.memberType}:${member.memberId}`}>
              <span>
                {member.memberType === "group"
                  ? groupNames.get(member.memberId) || member.memberId
                  : names.get(member.memberId) || member.memberId}
              </span>
              <button
                type="button"
                onClick={() =>
                  run(() =>
                    adminApi.removeMember(
                      id,
                      member.memberType === "group" ? "group" : "user",
                      member.memberId,
                    ),
                  )
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="admin-actions">
          <label>
            Add a person
            <select
              aria-label="Add a person"
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
            >
              <option value="">Choose a person</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name || user.email}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!personId}
            onClick={() => run(() => adminApi.addMember(id, "user", personId))}
          >
            Add person
          </button>
        </div>
        <div className="admin-actions">
          <label>
            Add a group
            <select
              aria-label="Add a group"
              value={childId}
              onChange={(e) => setChildId(e.target.value)}
            >
              <option value="">Choose a group</option>
              {groups
                .filter((group) => group.id !== id)
                .map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!childId}
            onClick={() => run(() => adminApi.addMember(id, "group", childId))}
          >
            Add group
          </button>
        </div>
      </section>
      <section className="admin-card">
        <h3>People in this group</h3>
        <ul className="admin-list" aria-label="People in this group">
          {detail.people.map((person) => (
            <li key={person}>
              <span>{names.get(person) || person}</span>
            </li>
          ))}
        </ul>
      </section>
      <button
        type="button"
        onClick={() =>
          void adminApi
            .deleteGroup(id)
            .then(onRemoved)
            .catch((e) => setError(message(e)))
        }
      >
        Remove group
      </button>
    </>
  );
}
