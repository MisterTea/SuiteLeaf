import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { generate } from "selfsigned";

// Disposable, loopback-only provider. No real credentials or external recipients.
const fixture = resolve("output", `mail-stalwart-${Date.now()}`);
mkdirSync(fixture, { recursive: true });
const name = `suiteleaf-mail-${Date.now()}`;
const password = randomBytes(24).toString("hex");
const admin = randomBytes(24).toString("hex");
const base = "http://127.0.0.1:18787";
const env = { ...process.env, STALWART_RECOVERY_ADMIN: `admin:${admin}` };
const docker = (...args) => {
  const result = spawnSync("docker", args, {
    env,
    windowsHide: true,
    encoding: "utf8",
  });
  if (result.status)
    throw new Error(`Docker ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url) {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* Starting. */
    }
    await pause(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}
async function jmap(method, args) {
  const response = await fetch("http://127.0.0.1:18080/jmap/", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`admin:${admin}`).toString("base64")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
      methodCalls: [[method, args, "c"]],
    }),
  });
  const result = (await response.json()).methodResponses?.[0];
  if (
    !response.ok ||
    result?.[0] === "error" ||
    result?.[1]?.notCreated ||
    result?.[1]?.notUpdated
  )
    throw new Error(
      `Stalwart ${method} failed (${response.status}); inspect fixture configuration.`,
    );
  return result[1];
}
let node;
let created = false;
try {
  docker(
    "run",
    "-d",
    "--name",
    name,
    "-p",
    "127.0.0.1:18080:8080",
    "-p",
    "127.0.0.1:19993:993",
    "-p",
    "127.0.0.1:1465:465",
    "-e",
    "STALWART_RECOVERY_ADMIN",
    "stalwartlabs/stalwart@sha256:73c684a84c24f5b4206ec266a8deb8986fe44a9f623997e07f084388d943c8bd",
  );
  created = true;
  await waitFor("http://127.0.0.1:18080/jmap/session");
  // Bootstrap returns an unused generated administrator password; never log it.
  await jmap("x:Bootstrap/set", {
    update: {
      singleton: {
        defaultHostname: "localhost",
        defaultDomain: "suiteleaf.test",
        requestTlsCertificate: false,
        generateDkimKeys: false,
      },
    },
  });
  docker("restart", name);
  await waitFor("http://127.0.0.1:18080/jmap/session");
  const domains = await jmap("x:Domain/query", {});
  const pems = await generate([{ name: "commonName", value: "localhost" }], {
    algorithm: "sha256",
    extensions: [
      { name: "basicConstraints", cA: true },
      {
        name: "subjectAltName",
        altNames: [
          { type: 7, ip: "127.0.0.1" },
          { type: 2, value: "localhost" },
        ],
      },
    ],
  });
  const ca = resolve(fixture, "ca.pem");
  writeFileSync(ca, pems.cert);
  const certificate = await jmap("x:Certificate/set", {
    create: {
      cert: {
        certificate: { "@type": "Text", value: pems.cert },
        privateKey: { "@type": "Text", secret: pems.private },
      },
    },
  });
  await jmap("x:SystemSettings/set", {
    update: {
      singleton: { defaultCertificateId: certificate.created.cert.id },
    },
  });
  await jmap("x:Account/set", {
    create: Object.fromEntries(
      ["alice", "bob"].map((user) => [
        user,
        {
          "@type": "User",
          name: user,
          domainId: domains.ids[0],
          credentials: { 0: { "@type": "Password", secret: password } },
        },
      ]),
    ),
  });
  docker("restart", name);
  await waitFor("http://127.0.0.1:18080/jmap/session");
  const config = resolve(fixture, "node.toml");
  writeFileSync(
    config,
    `data_dir = ${JSON.stringify(resolve(fixture, "data").replaceAll("\\", "/"))}\nhttp_addr = "127.0.0.1:18787"\npublic_url = "${base}"\nlisten = ["/ip4/127.0.0.1/tcp/0"]\nweb_root = "apps/web/dist"\n`,
  );
  const log = createWriteStream(resolve(fixture, "node.log"));
  node = spawn(
    resolve(
      `target/debug/suiteleaf-node${process.platform === "win32" ? ".exe" : ""}`,
    ),
    ["run", "--config", config, "--init"],
    {
      env: {
        ...process.env,
        NODE_EXTRA_CA_CERTS: ca,
        SUITELEAF_AUTH_SECRET: randomBytes(32).toString("hex"),
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  node.stdout.pipe(log);
  node.stderr.pipe(log);
  await waitFor(`${base}/api/auth/suiteleaf/providers`);
  console.log(
    "Stalwart 1.0.3 and SuiteLeaf are ready; testing real authenticated mail API.",
  );
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/mail-stalwart.test.ts",
      "--maxWorkers=1",
    ],
    {
      env: {
        ...process.env,
        SUITELEAF_MAIL_TEST_URL: base,
        SUITELEAF_MAIL_TEST_PASSWORD: password,
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  node?.kill();
  if (created) docker("rm", "-f", name);
}
