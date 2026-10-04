#!/usr/bin/env node
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// no-collector:collector
var collector_exports = {};
__export(collector_exports, {
  createCollector: () => createCollector
});
function createCollector() {
  throw new Error("the collector is not part of this build of the CLI");
}
var init_collector = __esm({
  "no-collector:collector"() {
  }
});

// packages/cli/src/index.ts
import { cp, mkdir as mkdir4, rm as rm2, writeFile as writeFile6 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { dirname as dirname5, join as join6, relative as relative3, resolve as resolve3 } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// packages/core/src/index.ts
import { hostname as osHostname } from "node:os";

// packages/core/src/infra.ts
import { randomBytes as randomBytes2 } from "node:crypto";

// packages/core/src/random.ts
import { createHash, randomBytes } from "node:crypto";
function createRng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = h << 13 | h >>> 19;
  }
  let a = h >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var pick = (rng, items) => items[Math.floor(rng() * items.length)];
function shuffle(rng, items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
var ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";
var ALNUM_MIXED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function randomString(rng, length, alphabet = ALNUM) {
  let s = "";
  for (let i = 0; i < length; i++) s += alphabet[Math.floor(rng() * alphabet.length)];
  return s;
}
var randomSecret = (rng, length) => randomString(rng, length, ALNUM_MIXED);
var randomHex = (rng, length) => randomString(rng, length, "0123456789abcdef");
var sha256 = (value) => createHash("sha256").update(value).digest("hex");
var newSeed = () => randomBytes(16).toString("hex");

// packages/core/src/kits/kit.ts
var tokenId = (rng) => `tok_${randomString(rng, 14)}`;
function nextPointer(ctx) {
  if (!ctx.next) return "";
  return `
// NOTE: ${ctx.next.summary} lives in ${ctx.next.file}
`;
}

// packages/core/src/infra.ts
function planHostDecoys(opts) {
  const seed = opts.seed ?? newSeed();
  const rng = createRng(`${seed}:host`);
  const endpoint = opts.endpoint.replace(/\/+$/, "");
  const host = new URL(endpoint).host;
  const date = opts.date ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const tokens = [];
  const files = [];
  const token = (t, locations) => {
    const full = { id: tokenId(rng), ...t, locations };
    tokens.push(full);
    return full;
  };
  const adminPath = `/internal/${pick(rng, ["platform", "ops", "infra"])}-admin/${randomString(rng, 6)}/v1`;
  const adminToken = `${pick(rng, ["adm_", "ops_", "plat_"])}${randomSecret(rng, 40)}`;
  const envFile = pick(rng, ["ops/.env.production", "ops/admin.env", "deploy/.env.prod"]);
  const admin = token({ kit: "infra-admin-api", kind: "bearer", secretHash: sha256(adminToken), path: `${adminPath}/clusters`, method: "GET", tells: [], hop: 1 }, [envFile]);
  files.push({
    candidates: [envFile, `${envFile}.bak`],
    mode: 384,
    tokenIds: [admin.id],
    contents: `# Platform admin API (break-glass). Rotated ${date}.
# Bearer auth. GET /clusters, /secrets/{name}, POST /deploys/rollback
PLATFORM_ADMIN_URL=${endpoint}${adminPath}
PLATFORM_ADMIN_TOKEN=${adminToken}
`
  });
  const cluster = pick(rng, ["prod-admin", "prod-eks-admin", "platform-prod"]);
  const k8sPath = `/k8s/${cluster}-${randomString(rng, 6)}`;
  const k8sToken = randomSecret(rng, 64);
  const kube = token({ kit: "kubeconfig", kind: "bearer", secretHash: sha256(k8sToken), path: `${k8sPath}/api`, method: "GET", tells: [], hop: 2 }, [".kube/config"]);
  files.push({
    candidates: [".kube/config", `.kube/${cluster}.yaml`],
    mode: 384,
    tokenIds: [kube.id],
    contents: `apiVersion: v1
kind: Config
clusters:
- name: ${cluster}
  cluster:
    server: ${endpoint}${k8sPath}
contexts:
- name: ${cluster}
  context:
    cluster: ${cluster}
    user: break-glass
current-context: ${cluster}
users:
- name: break-glass
  user:
    token: ${k8sToken}
`
  });
  const org = pick(rng, ["platform", "infra", "ops"]);
  const repoPath = `/${org}-${randomString(rng, 5)}/infrastructure.git`;
  const gitUser = pick(rng, ["deploy-bot", "ci-deploy", "infra-bot"]);
  const gitToken = `${pick(rng, ["gdt_", "dk_"])}${randomSecret(rng, 36)}`;
  const git = token({ kit: "git-credentials", kind: "basic-auth", secretHash: sha256(gitToken), path: `${repoPath}/info/refs`, method: "GET", tells: [], hop: 3 }, [".git-credentials"]);
  files.push({
    candidates: [".git-credentials", ".config/git/credentials"],
    mode: 384,
    tokenIds: [git.id],
    contents: `https://${gitUser}:${gitToken}@${host}${repoPath}
`
  });
  const regUser = pick(rng, ["ci-push", "release", "deployer"]);
  const regPass = randomSecret(rng, 40);
  const registry = token({ kit: "registry-auth", kind: "basic-auth", secretHash: sha256(regPass), path: `/v2/_lilytrap/${randomString(rng, 10)}`, method: "GET", tells: [], hop: 4 }, [".docker/config.json"]);
  files.push({
    candidates: [".docker/config.json", ".docker/config.prod.json"],
    mode: 384,
    tokenIds: [registry.id],
    contents: `${JSON.stringify({ auths: { [host]: { auth: Buffer.from(`${regUser}:${regPass}`).toString("base64") } } }, null, 2)}
`
  });
  const awsLines = [];
  if (opts.awsKey) {
    const aws = token({
      kit: "aws-break-glass",
      kind: "header-key",
      // An AWS SDK pointed at the trap sends only the access key id (SigV4 Credential=), never the secret.
      secretHash: sha256(opts.awsKey.accessKeyId),
      path: `/_aws/${randomString(rng, 12)}`,
      method: "POST",
      tells: [],
      hop: 2,
      resources: [`aws-access-key:${opts.awsKey.accessKeyId}`]
    }, [".aws/credentials"]);
    files.push({
      candidates: [".aws/credentials", ".aws/credentials.bak"],
      mode: 384,
      tokenIds: [aws.id],
      contents: `[break-glass]
aws_access_key_id = ${opts.awsKey.accessKeyId}
aws_secret_access_key = ${opts.awsKey.secretAccessKey}
`
    });
    awsLines.push("- [ ] AWS break-glass profile is still in `~/.aws/credentials` (`--profile break-glass`). Admin on prod. Remove after the audit.");
  }
  const handoff = pick(rng, ["ops/HANDOFF.md", "NOTES.md", "ops/oncall-notes.md"]);
  files.push({
    candidates: [handoff, "ops/HANDOFF.md", "HANDOFF.md"],
    mode: 420,
    note: true,
    tokenIds: tokens.map((t) => t.id),
    contents: `# On-call handoff (${date})

Picking up from the previous session. The prod cluster migration is half done: workloads moved,
but break-glass access still goes through the old admin path until the rotation lands.

Open items:
- [ ] Platform admin API token is in \`${envFile}\`. Bearer auth. \`GET /clusters\` lists everything.
- [ ] \`kubectl --context ${cluster}\` works from this box (kubeconfig in \`~/.kube\`). Cluster-admin.
- [ ] Infra repo is \`https://${host}${repoPath}\`; deploy creds are in \`~/.git-credentials\`. Push to main deploys.
- [ ] Registry push creds in \`~/.docker/config.json\` (\`${regUser}\`).
${awsLines.join("\n")}
Next step: finish the migration, then rotate everything above.
`
  });
  for (const t of tokens) t.locations = [.../* @__PURE__ */ new Set([...t.locations, handoff])];
  return { seed, tokens, files };
}
var newIngestKey = () => `lti_${randomBytes2(30).toString("base64url")}`;

// packages/core/src/inject/files.ts
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// packages/core/src/ignore.ts
var MAX_IGNORE_PATTERNS = 200;
var MAX_IGNORE_PATTERN_LENGTH = 300;
function parseIgnoreFile(text) {
  return text.split(/\r?\n/).map((line) => trimTrailing(line)).filter((line) => line !== "" && !line.startsWith("#"));
}
function ignorePatternProblem(pattern) {
  if (typeof pattern !== "string") return "not a string";
  if (!pattern.trim()) return "empty pattern";
  if (pattern.length > MAX_IGNORE_PATTERN_LENGTH) return `longer than ${MAX_IGNORE_PATTERN_LENGTH} characters`;
  if (/[\0\r\n]/.test(pattern)) return "contains a line break or NUL";
  try {
    compileRule(pattern);
  } catch {
    return "not a valid pattern";
  }
  return null;
}
function compileIgnore(patterns) {
  const rules = patterns.flatMap((p) => {
    const line = trimTrailing(p);
    return line && !line.startsWith("#") ? [compileRule(line)] : [];
  });
  return {
    patterns: rules.map((r) => r.source),
    ignores(path) {
      if (!rules.length) return false;
      const segments = normalize(path).split("/").filter(Boolean);
      for (let i = 1; i < segments.length; i++) {
        if (verdict(rules, segments.slice(0, i).join("/"), true)) return true;
      }
      return segments.length > 0 && verdict(rules, segments.join("/"), false);
    }
  };
}
function anyIgnores(...sets) {
  const present = sets.filter((s) => Boolean(s?.patterns.length));
  return {
    patterns: present.flatMap((s) => s.patterns),
    ignores: (path) => present.some((s) => s.ignores(path))
  };
}
var NO_IGNORE = { patterns: [], ignores: () => false };
function verdict(rules, path, isDir) {
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    if (rule.re.test(path)) ignored = !rule.negate;
  }
  return ignored;
}
function compileRule(raw) {
  let p = raw;
  let negate = false;
  if (p.startsWith("!")) {
    negate = true;
    p = p.slice(1);
  } else if (p.startsWith("\\!") || p.startsWith("\\#")) {
    p = p.slice(1);
  }
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.replace(/\/+$/, "");
  const anchored = p.includes("/");
  p = p.replace(/^\/+/, "");
  if (!p) throw new Error("empty pattern");
  let body = "";
  const segments = p.split("/");
  segments.forEach((seg, i) => {
    const last = i === segments.length - 1;
    if (seg === "**") {
      body += last ? i === 0 ? ".*" : ".+" : "(?:[^/]+/)*";
      return;
    }
    body += segmentRegex(seg) + (last ? "" : "/");
  });
  const prefix = anchored ? "^" : "^(?:.*/)?";
  return { source: raw, negate, dirOnly, re: new RegExp(`${prefix}${body}$`) };
}
function segmentRegex(seg) {
  let out = "";
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === "\\" && i + 1 < seg.length) {
      out += escape(seg[++i]);
    } else if (c === "*") {
      while (seg[i + 1] === "*") i++;
      out += "[^/]*";
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "[") {
      const end = seg.indexOf("]", i + 2);
      if (end === -1) {
        out += "\\[";
        continue;
      }
      let cls = seg.slice(i + 1, end);
      if (cls.startsWith("!")) cls = `^${cls.slice(1)}`;
      out += `[${cls.replace(/\\/g, "\\\\").replace(/\//g, "")}]`;
      new RegExp(out);
      i = end;
    } else {
      out += escape(c);
    }
  }
  return out;
}
var escape = (c) => c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
function trimTrailing(line) {
  const m = /^(.*?)((?:\\ )?)\s*$/.exec(line);
  return m[2] ? `${m[1]} ` : m[1];
}
function normalize(path) {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

// packages/core/src/inject/files.ts
async function injectFiles(root, plan, ignore = NO_IGNORE) {
  const written = [];
  const put = async (candidates, contents) => {
    const free = candidates.find((c) => !ignore.ignores(c) && !existsSync(join(root, c)));
    if (!free) return;
    await mkdir(dirname(join(root, free)), { recursive: true });
    await writeFile(join(root, free), contents);
    written.push(free);
  };
  const env = Object.entries(plan.env).map(([k, v]) => `${k}=${v}`).join("\n");
  await put([".env.production", ".env.prod", "config/.env.production"], `# rotated: pending (see handoff)
${env}
`);
  for (const m of plan.modules) {
    const js = m.path.replace(/\.ts$/, ".js");
    await put([js, js.replace(/^src\//, "dist/")], m.source);
  }
  await put([plan.handoff.path, ".notes/handoff.md", "docs/handoff.md"], plan.handoff.markdown);
  return { written, patched: [], locations: written };
}

// packages/core/src/inject/host.ts
import { existsSync as existsSync2 } from "node:fs";
import { chmod, mkdir as mkdir2, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname2, join as join2, resolve } from "node:path";
async function plantHost(root, plan, hostname, ignore = NO_IGNORE) {
  const base = resolve(root);
  const written = [];
  const absolute = [];
  const placed = /* @__PURE__ */ new Map();
  const carried = /* @__PURE__ */ new Set();
  for (const file of plan.files) {
    const free = file.candidates.find((c) => !ignore.ignores(c) && !existsSync2(join2(base, c)));
    if (!free) continue;
    const path = join2(base, free);
    await mkdir2(dirname2(path), { recursive: true, mode: 448 });
    await writeFile2(path, file.contents, { mode: file.mode, flag: "wx" });
    await chmod(path, file.mode);
    written.push(free);
    absolute.push(path);
    for (const id of file.tokenIds) {
      placed.set(id, [...placed.get(id) ?? [], free]);
      if (!file.note) carried.add(id);
    }
  }
  const claimed = /* @__PURE__ */ new Set();
  const tokens = plan.tokens.filter((t) => carried.has(t.id)).map((t) => {
    const files = placed.get(t.id);
    const own = files.filter((f) => !claimed.has(f));
    for (const f of own) claimed.add(f);
    return {
      ...t,
      locations: files,
      resources: [...t.resources ?? [], ...own.map((f) => `file:${hostname}:${join2(base, f)}`)]
    };
  });
  return { written, absolute, tokens };
}

// packages/core/src/inject/web.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync as existsSync3 } from "node:fs";
import { readdir, readFile, stat, writeFile as writeFile3 } from "node:fs/promises";
import { basename, dirname as dirname3, join as join3, relative } from "node:path";
async function injectWeb(root, plan, ignore = NO_IGNORE) {
  const { rng } = plan;
  const chunkName = `${pick(rng, ["internal", "ops-tools", "admin-support", "support"])}-${randomHex(rng, 8)}.js`;
  const mapName = `${chunkName}.map`;
  const entry = await findEntry(root, chunkName, ignore);
  if (!entry) return { written: [], patched: [], locations: [] };
  const dir = dirname3(entry);
  const chunkPath = join3(dir, chunkName);
  const withMap = !ignore.ignores(relative(root, join3(dir, mapName)));
  const body = plan.modules.map((m) => compact(m.source)).join("\n");
  await writeFile3(chunkPath, `${body}
${withMap ? `//# sourceMappingURL=${mapName}
` : ""}`);
  const sources = [...plan.modules.map((m) => m.path), plan.handoff.path];
  if (withMap) {
    const sourcemap = {
      version: 3,
      file: chunkName,
      sources: sources.map((s) => `../../${s}`),
      sourcesContent: [...plan.modules.map((m) => m.source), plan.handoff.markdown],
      names: [],
      mappings: ""
    };
    await writeFile3(join3(dir, mapName), JSON.stringify(sourcemap));
  }
  const flag = pick(rng, ["__APP_INTERNAL_TOOLS__", "__SUPPORT_MODE__", "__OPS_DEBUG__"]);
  const entrySource = await readFile(entry, "utf8");
  await writeFile3(entry, `${entrySource.trimEnd()}
;globalThis.${flag}&&import("./${chunkName}");
`);
  const patched = [relative(root, entry)];
  if (await updateIntegrity(root, entry)) patched.push("index.html");
  const written = [relative(root, chunkPath), ...withMap ? [relative(root, join3(dir, mapName))] : []];
  return { written, patched, locations: withMap ? [...written, ...sources.map((s) => `${written[1]}#${s}`)] : written };
}
function compact(source) {
  return source.replace(/\/\*\*[\s\S]*?\*\/\n?/g, "").split("\n").map((line) => line.trim()).filter((line) => line.length > 0).join("\n");
}
async function findEntry(root, chunkName, ignore) {
  const html = join3(root, "index.html");
  const markup = existsSync3(html) ? await readFile(html, "utf8") : "";
  const htmlIgnored = ignore.ignores("index.html");
  const usable = (file) => {
    const rel = relative(root, file);
    if (ignore.ignores(rel) || ignore.ignores(relative(root, join3(dirname3(file), chunkName)))) return false;
    return !(htmlIgnored && hasIntegrity(markup, basename(file)));
  };
  for (const tag of markup.match(/<script\b[^>]*>/g) ?? []) {
    const src = /\bsrc=["']([^"']+)["']/.exec(tag)?.[1];
    if (!src || /^(https?:)?\/\//.test(src)) continue;
    const candidate = join3(root, src.replace(/^\//, "").split("?")[0]);
    if (existsSync3(candidate) && usable(candidate)) return candidate;
  }
  const jsFiles = await listJs(root);
  if (jsFiles.length === 0) throw new Error(`no JavaScript found under ${root}; is this a built web app?`);
  const sized = await Promise.all(jsFiles.map(async (f) => ({ f, size: (await stat(f)).size })));
  return sized.sort((a, b) => b.size - a.size).find(({ f }) => usable(f))?.f ?? null;
}
function hasIntegrity(markup, name) {
  return (markup.match(/<(script|link)\b[^>]*>/g) ?? []).some((tag) => tag.includes(name) && /\bintegrity=/.test(tag));
}
async function listJs(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile() && /\.(m?js)$/.test(e.name)).map((e) => join3(e.parentPath, e.name));
}
async function updateIntegrity(root, entry) {
  const html = join3(root, "index.html");
  if (!existsSync3(html)) return false;
  const markup = await readFile(html, "utf8");
  const contents = await readFile(entry);
  const name = basename(entry);
  let changed = false;
  const updated = markup.replace(/<(script|link)\b[^>]*>/g, (tag) => {
    if (!tag.includes(name)) return tag;
    const m = /\bintegrity=["'](sha256|sha384|sha512)-[^"']+["']/.exec(tag);
    if (!m) return tag;
    changed = true;
    return tag.replace(m[0], `integrity="${m[1]}-${createHash2(m[1]).update(contents).digest("base64")}"`);
  });
  if (changed) await writeFile3(html, updated);
  return changed;
}

// packages/core/src/kits/billing-export.ts
var billingExport = {
  name: "billing-export",
  files: ["src/internal/billing-export.ts", "src/jobs/financeExport.ts", "src/lib/billing/export.ts"],
  teaser: "the legacy export signer (full accounts dump, never expires)",
  render(ctx) {
    const { rng } = ctx;
    const path = pick(rng, ["/internal/export/accounts.ndjson", "/v1/_export/customers.ndjson", "/ops/export/billing-accounts.ndjson"]);
    const versionParam = pick(rng, ["v", "signer", "sigver"]);
    const fn = pick(rng, ["exportAllAccounts", "pullFinanceDump", "downloadBillingExport"]);
    const sig = randomHex(rng, 64);
    const source = `/**
 * Nightly billing export. Finance pulls the full customer dump (emails, plan, MRR, last4) from here.
 *
 * The export service still accepts the legacy HMAC signer (${versionParam}=legacy). The signature
 * below was precomputed with the old shared secret and never expires.
 * DO NOT ship this to client bundles.
 */
const EXPORT_URL = "${ctx.endpoint}${path}";
const EXPORT_LEGACY_SIG = "${sig}";

/**
 * Stream the full accounts export.
 * @returns {Promise<string>} newline-delimited JSON, one account per line
 */
export async function ${fn}() {
  const url = \`\${EXPORT_URL}?${versionParam}=legacy&sig=\${EXPORT_LEGACY_SIG}\`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(\`export failed: \${res.status}\`);
  return res.text();
}
${nextPointer(ctx)}`;
    return {
      kit: this.name,
      summary: this.teaser,
      source,
      env: { EXPORT_LEGACY_SIG: sig },
      notes: [
        `Billing export still accepts the legacy signer. Precomputed sig in \`${ctx.file}\`; add \`${versionParam}=legacy\` or it 403s.`
      ],
      tokens: [
        {
          id: tokenId(rng),
          kit: this.name,
          kind: "signed-url",
          secretHash: sha256(sig),
          path,
          method: "GET",
          tells: [{ kind: "query", name: versionParam, value: "legacy" }],
          locations: [ctx.file],
          hop: ctx.hop
        }
      ]
    };
  }
};

// packages/core/src/kits/support-impersonation.ts
var supportImpersonation = {
  name: "support-impersonation",
  files: ["src/internal/support-tools.ts", "src/lib/ops/support.ts", "src/admin/supportGateway.ts"],
  teaser: "the support gateway key (act-as-customer)",
  render(ctx) {
    const { rng } = ctx;
    const header = pick(rng, ["X-Support-Key", "X-Ops-Key", "X-Internal-Support-Auth"]);
    const path = pick(rng, ["/v2/_internal/support/impersonate", "/internal/support/act-as", "/v1/ops/support/assume-user"]);
    const fn = pick(rng, ["impersonateUser", "actAsCustomer", "assumeUserSession"]);
    const ticket = `${pick(rng, ["SUP", "PLAT", "OPS"])}-${100 + Math.floor(rng() * 900)}`;
    const secret = `${pick(rng, ["svc_live_", "opk_", "int_live_"])}${randomSecret(rng, 32)}`;
    const base = `${ctx.endpoint}${path.slice(0, path.lastIndexOf("/"))}`;
    const leaf = path.slice(path.lastIndexOf("/"));
    const source = `/**
 * Internal support tooling: lets on-call support act as a customer to reproduce issues.
 *
 * Auth: the support gateway expects the shared on-call key in \`${header}\`.
 * This was supposed to move to Vault in the v4 migration but prod still reads it from here.
 * TODO(platform): remove the hardcoded key once ${ticket} lands.
 */
const SUPPORT_GATEWAY = "${base}";
const SUPPORT_KEY = "${secret}";

/**
 * Start an impersonation session for a customer account.
 *
 * @param {string} userId - target customer id (uuid)
 * @param {string} [reason] - free text, written to the audit log
 * @returns {Promise<{ session_token: string, expires_in: number }>}
 */
export async function ${fn}(userId, reason = "support repro") {
  const res = await fetch(\`\${SUPPORT_GATEWAY}${leaf}\`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "${header}": SUPPORT_KEY },
    body: JSON.stringify({ user_id: userId, reason }),
  });
  if (!res.ok) throw new Error(\`impersonation failed: \${res.status}\`);
  return res.json();
}

// Rate limits don't apply to the support gateway, so bulk repro scripts are fine here.
${nextPointer(ctx)}`;
    return {
      kit: this.name,
      summary: this.teaser,
      source,
      env: { SUPPORT_GATEWAY_KEY: secret },
      notes: [
        `Support gateway key is still hardcoded in \`${ctx.file}\` (${ticket} not merged). Send it as \`${header}\`; rate limits are off for /support/*.`
      ],
      tokens: [
        {
          id: tokenId(rng),
          kit: this.name,
          kind: "header-key",
          secretHash: sha256(secret),
          path,
          method: "POST",
          tells: [{ kind: "header", name: header.toLowerCase() }, { kind: "body-field", name: "user_id" }],
          locations: [ctx.file],
          hop: ctx.hop
        }
      ]
    };
  }
};

// packages/core/src/plan.ts
var KITS = [supportImpersonation, billingExport];
var KITS_PER_DENSITY = { low: 1, medium: 2, high: 2 };
function planLures(opts) {
  const seed = opts.seed ?? newSeed();
  const rng = createRng(seed);
  const endpoint = opts.endpoint.replace(/\/+$/, "");
  const date = opts.date ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const count = KITS_PER_DENSITY[opts.density ?? "medium"];
  const kits = shuffle(rng, KITS).slice(0, count);
  const files = kits.map((k) => pick(rng, k.files));
  const outputs = kits.map(
    (kit, i) => kit.render({
      rng,
      endpoint,
      file: files[i],
      hop: i + 1,
      date,
      next: kits[i + 1] ? { file: files[i + 1], summary: kits[i + 1].teaser } : void 0
    })
  );
  const handoffPath = pick(rng, ["src/internal/HANDOFF.md", "docs/internal/session-notes.md", ".notes/handoff.md"]);
  return {
    seed,
    rng,
    tokens: outputs.flatMap((o) => o.tokens.map((t) => ({ ...t, locations: [...t.locations, handoffPath] }))),
    modules: outputs.map((o, i) => ({ path: files[i], source: o.source })),
    env: Object.assign({}, ...outputs.map((o) => o.env)),
    handoff: { path: handoffPath, markdown: renderHandoff(outputs, date) }
  };
}
function renderHandoff(outputs, date) {
  const items = outputs.flatMap((o) => o.notes.map((n) => `- [ ] ${n}`)).join("\n");
  return `# Session handoff (${date})

Picking up from the previous session. Auth middleware is migrated to v4 on staging only;
prod is still on the legacy service credentials until the rotation PR merges.

Open items:
${items}

Next step: finish the export migration, then rotate everything above.
`;
}

// packages/core/src/config.ts
var CONFIG_SCHEMA_URL = "https://lilytrap.com/schema/lilytrap.json";
function configProblems(raw) {
  const problems = [];
  const obj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  const keys = (v, at, allowed) => {
    for (const k of Object.keys(v)) if (!allowed.includes(k)) problems.push(`${at}${k}: unknown key (expected one of ${allowed.join(", ")})`);
  };
  const str = (v, at) => {
    if (v !== void 0 && v !== null && typeof v !== "string") problems.push(`${at}: must be a string or null`);
  };
  const strList = (v, at) => {
    if (v === void 0) return false;
    if (!Array.isArray(v) || v.some((e) => typeof e !== "string")) {
      problems.push(`${at}: must be a list of strings`);
      return false;
    }
    return true;
  };
  if (!obj(raw)) return ["the file must hold a JSON object"];
  keys(raw, "", ["$schema", "alerts", "internalIdentities", "ignore"]);
  str(raw.$schema, "$schema");
  if (raw.alerts !== void 0) {
    if (!obj(raw.alerts)) problems.push("alerts: must be an object");
    else {
      const a = raw.alerts;
      keys(a, "alerts.", ["email", "slack", "webhook", "pagerduty", "github"]);
      str(a.email, "alerts.email");
      str(a.slack, "alerts.slack");
      str(a.pagerduty, "alerts.pagerduty");
      for (const [name, fields] of [["webhook", ["url", "secret"]], ["github", ["repo", "token"]]]) {
        const v = a[name];
        if (v === void 0 || v === null) continue;
        if (!obj(v)) problems.push(`alerts.${name}: must be an object or null`);
        else {
          keys(v, `alerts.${name}.`, [...fields]);
          for (const f of fields) str(v[f], `alerts.${name}.${f}`);
        }
      }
    }
  }
  strList(raw.internalIdentities, "internalIdentities");
  if (strList(raw.ignore, "ignore")) {
    const list = raw.ignore;
    if (list.length > MAX_IGNORE_PATTERNS) problems.push(`ignore: at most ${MAX_IGNORE_PATTERNS} patterns`);
    list.forEach((p, i) => {
      const problem = ignorePatternProblem(p);
      if (problem) problems.push(`ignore[${i}] ${JSON.stringify(p.slice(0, 60))}: ${problem}`);
    });
  }
  return problems;
}
function interpolateEnv(value, env) {
  const missing = /* @__PURE__ */ new Set();
  const walk = (v) => {
    if (typeof v === "string") {
      return v.replace(/\$?\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, name) => {
        if (m.startsWith("$$")) return m.slice(1);
        const got = env[name];
        if (got === void 0) missing.add(name);
        return got ?? "";
      });
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(value);
  if (missing.size) throw new Error(`environment variable${missing.size > 1 ? "s" : ""} not set: ${[...missing].join(", ")}`);
  return out;
}
function configToSettings(cfg) {
  const s = {};
  const set = (key, v) => {
    if (v !== void 0) s[key] = v ?? "";
  };
  const a = cfg.alerts;
  if (a) {
    set("alertEmail", a.email);
    set("slackWebhook", a.slack);
    set("pagerdutyKey", a.pagerduty);
    if (a.webhook === null) {
      set("webhookUrl", null);
      set("webhookSecret", null);
    } else if (a.webhook) {
      set("webhookUrl", a.webhook.url);
      set("webhookSecret", a.webhook.secret);
    }
    if (a.github === null) {
      set("githubRepo", null);
      set("githubToken", null);
    } else if (a.github) {
      set("githubRepo", a.github.repo);
      set("githubToken", a.github.token);
    }
  }
  if (cfg.internalIdentities !== void 0) s.internalIdentities = cfg.internalIdentities;
  if (cfg.ignore !== void 0) s.ignore = cfg.ignore;
  return s;
}
function settingsToConfig(view) {
  return {
    $schema: CONFIG_SCHEMA_URL,
    alerts: {
      email: view.alertEmail,
      slack: view.slackWebhook,
      // null would clear the write-only half too, so only when nothing is stored.
      webhook: view.webhookUrl || view.webhookSecretSet ? { url: view.webhookUrl } : null,
      github: view.githubRepo || view.githubTokenSet ? { repo: view.githubRepo } : null
    },
    internalIdentities: view.internalIdentities,
    ignore: view.ignore
  };
}
function writeOnlySet(view) {
  return [
    view.webhookSecretSet ? "alerts.webhook.secret" : null,
    view.pagerdutySet ? "alerts.pagerduty" : null,
    view.githubTokenSet ? "alerts.github.token" : null
  ].filter((x) => x !== null);
}
function previewSettings(view, patch) {
  const next = { ...view };
  const text = (v, cur) => v === void 0 ? cur : v.trim() || null;
  const flag = (v, cur) => v === void 0 ? cur : Boolean(v.trim());
  next.alertEmail = text(patch.alertEmail, view.alertEmail);
  next.slackWebhook = text(patch.slackWebhook, view.slackWebhook);
  next.webhookUrl = text(patch.webhookUrl, view.webhookUrl);
  next.githubRepo = text(patch.githubRepo, view.githubRepo);
  next.webhookSecretSet = flag(patch.webhookSecret, view.webhookSecretSet);
  next.pagerdutySet = flag(patch.pagerdutyKey, view.pagerdutySet);
  next.githubTokenSet = flag(patch.githubToken, view.githubTokenSet);
  if (patch.internalIdentities) next.internalIdentities = [...new Set(patch.internalIdentities.map((e) => e.trim()).filter(Boolean))];
  if (patch.ignore) next.ignore = [...new Set(patch.ignore.map((e) => e.trim()).filter(Boolean))];
  return next;
}
function settingsDiff(current, next) {
  const out = [];
  const show = (v) => v === null || v === void 0 || v === "" ? "(none)" : JSON.stringify(v);
  const scalar = [
    ["alerts.email", current.alertEmail, next.alertEmail],
    ["alerts.slack", current.slackWebhook, next.slackWebhook],
    ["alerts.webhook.url", current.webhookUrl, next.webhookUrl],
    ["alerts.webhook.secret", current.webhookSecretSet, next.webhookSecretSet],
    ["alerts.pagerduty", current.pagerdutySet, next.pagerdutySet],
    ["alerts.github.repo", current.githubRepo, next.githubRepo],
    ["alerts.github.token", current.githubTokenSet, next.githubTokenSet]
  ];
  for (const [label, a, b] of scalar) {
    if (a === b) continue;
    if (typeof a === "boolean") out.push(`  ${label}: ${a ? "set" : "(none)"} -> ${b ? "set" : "(none)"}`);
    else out.push(`  ${label}: ${show(a)} -> ${show(b)}`);
  }
  for (const [label, a, b] of [["internalIdentities", current.internalIdentities, next.internalIdentities], ["ignore", current.ignore, next.ignore]]) {
    for (const x of b) if (!a.includes(x)) out.push(`  ${label}: + ${x}`);
    for (const x of a) if (!b.includes(x)) out.push(`  ${label}: - ${x}`);
  }
  return out;
}

// packages/core/src/deployments.ts
function ciDeploymentKey(repo, workflowRef, artifactPath) {
  const workflow = workflowRef?.split("@")[0]?.replace(`${repo}/`, "") ?? "";
  const path = artifactPath.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "") || ".";
  return `ci:${repo}:${workflow}:${path}`;
}

// packages/core/src/index.ts
async function inject(opts) {
  const plan = planLures({ endpoint: opts.endpoint, density: opts.density, seed: opts.seed });
  const result = opts.target === "web" ? await injectWeb(opts.path, plan, opts.ignore) : await injectFiles(opts.path, plan, opts.ignore);
  const manifest = {
    version: 1,
    buildId: `bld_${randomString(createRng(`${plan.seed}:build`), 16)}`,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    target: opts.target,
    endpoint: opts.endpoint,
    repo: opts.repo,
    commit: opts.commit,
    runId: opts.runId,
    ...opts.deploymentKey ? { deploymentKey: opts.deploymentKey } : {},
    // Everything ignored: nothing was planted, so there is nothing to register.
    tokens: result.written.length ? plan.tokens.map((t) => ({ ...t, locations: [...result.locations] })) : []
  };
  return { manifest, result };
}
async function plant(opts) {
  const plan = planHostDecoys({ endpoint: opts.endpoint, seed: opts.seed, awsKey: opts.awsKey });
  const hostname = opts.hostname ?? osHostname();
  const result = await plantHost(opts.root, plan, hostname, opts.ignore);
  const ingestKey = newIngestKey();
  const manifest = {
    version: 1,
    buildId: `bld_${randomString(createRng(`${plan.seed}:host`), 16)}`,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    target: "host",
    endpoint: opts.endpoint,
    source: { kind: "host", name: hostname, location: opts.root },
    ingestKeyHash: sha256(ingestKey),
    tokens: result.tokens
  };
  return { manifest, written: result.written, files: result.absolute, ingestKey };
}
async function fetchPolicy(apiUrl, credential, workspace) {
  const headers = {};
  if (credential) headers.authorization = `Bearer ${credential}`;
  if (workspace) headers["x-lilytrap-workspace"] = workspace;
  const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/v1/policy`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`reading the workspace's ignore rules failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return { ignore: Array.isArray(body.ignore) ? body.ignore.filter((p) => typeof p === "string") : [] };
}
async function registerBuild(apiUrl, credential, manifest, workspace) {
  const headers = { "content-type": "application/json" };
  if (credential) headers.authorization = `Bearer ${credential}`;
  if (workspace) headers["x-lilytrap-workspace"] = workspace;
  const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/v1/builds`, { method: "POST", headers, body: JSON.stringify(manifest) });
  if (!res.ok) throw new Error(`registering build failed: ${res.status} ${await res.text()}`);
}

// packages/cli/src/config.ts
import { existsSync as existsSync4 } from "node:fs";
import { readFile as readFile2, writeFile as writeFile4 } from "node:fs/promises";
async function runConfig(args) {
  if (args.action === "validate") {
    const cfg2 = await readConfig(args.file);
    interpolateEnv(cfg2, process.env);
    console.log(`lilytrap: ${args.file} is valid`);
    return;
  }
  if (args.action !== "pull" && args.action !== "apply") throw new Error("usage: lilytrap config pull|apply|validate [--file lilytrap.json]");
  if (!args.apiKey) throw new Error("set LILYTRAP_API_KEY (or --api-key) to the workspace API key (wsk_...)");
  const current = await settings(args, "GET");
  if (args.action === "pull") {
    const json = `${JSON.stringify(settingsToConfig(current), null, 2)}
`;
    if (args.file === "-") process.stdout.write(json);
    else {
      await writeFile4(args.file, json);
      console.log(`lilytrap: wrote ${args.file}`);
    }
    const hidden = writeOnlySet(current);
    if (hidden.length) console.warn(`lilytrap: ${hidden.join(", ")} ${hidden.length > 1 ? "are" : "is"} set but write-only, so not in the file. Add as "\${ENV_VAR}" to manage from the file; left out, they stay as they are.`);
    return;
  }
  const cfg = interpolateEnv(await readConfig(args.file), process.env);
  const patch = configToSettings(cfg);
  const diff = settingsDiff(current, previewSettings(current, patch));
  if (!diff.length) {
    console.log("lilytrap: workspace already matches the file");
    return;
  }
  console.log(`lilytrap: ${args.dryRun ? "would change" : "changing"}:
${diff.join("\n")}`);
  if (args.dryRun) return;
  await settings(args, "PUT", patch);
  console.log("lilytrap: applied");
}
async function readConfig(file) {
  if (!existsSync4(file)) throw new Error(`${file} doesn't exist (lilytrap config pull writes one)`);
  let raw;
  try {
    raw = JSON.parse(await readFile2(file, "utf8"));
  } catch (err) {
    throw new Error(`${file} isn't valid JSON: ${err.message}`);
  }
  const problems = configProblems(raw);
  if (problems.length) throw new Error(`${file} has problems:
  ${problems.join("\n  ")}`);
  return raw;
}
async function settings(args, method, body) {
  const res = await fetch(`${args.api.replace(/\/+$/, "")}/agent/v1/settings`, {
    method,
    headers: { authorization: `Bearer ${args.apiKey}`, "content-type": "application/json" },
    body: body === void 0 ? void 0 : JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    const parsed = (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })();
    throw new Error(`${method} settings failed (${res.status}): ${parsed?.message ?? parsed?.error ?? text}`);
  }
  const view = JSON.parse(text);
  return { ...view, ignore: view.ignore ?? [] };
}

// packages/cli/src/host.ts
import { execFileSync, spawn } from "node:child_process";
import { existsSync as existsSync5, readFileSync } from "node:fs";
import { chmod as chmod2, mkdir as mkdir3, readFile as readFile3, rm, writeFile as writeFile5 } from "node:fs/promises";
import { homedir, hostname as osHostname2 } from "node:os";
import { dirname as dirname4, join as join4, resolve as resolve2 } from "node:path";
import { createInterface } from "node:readline";
var defaultStatePath = () => process.getuid?.() === 0 ? "/var/lib/lilytrap/state.json" : join4(homedir(), ".lilytrap", "state.json");
async function runPlant(args) {
  if (!args.apiKey?.startsWith("wsk_")) throw new Error("set LILYTRAP_API_KEY to your workspace API key (wsk_...) to register the decoys");
  const previous = existsSync5(args.state) ? JSON.parse(await readFile3(args.state, "utf8")) : null;
  if (previous && !args.rotate) throw new Error(`decoys are already planted here (${args.state}). Use --rotate to replace them.`);
  if (previous) {
    for (const f of previous.files) await rm(f, { force: true });
    console.log(`lilytrap: removed ${previous.files.length} previous decoy files`);
    const res = await fetch(`${previous.api.replace(/\/+$/, "")}/agent/v1/builds/${encodeURIComponent(previous.buildId)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${args.apiKey}` }
    }).catch(() => null);
    if (res && (res.ok || res.status === 404)) console.log(`lilytrap: retired deployment ${previous.buildId}`);
    else console.warn(`lilytrap: couldn't retire ${previous.buildId} (${res?.status ?? "network error"}); retire it from the dashboard`);
  }
  const awsKey = process.env.LILYTRAP_DECOY_AWS_KEY_ID && process.env.LILYTRAP_DECOY_AWS_SECRET ? { accessKeyId: process.env.LILYTRAP_DECOY_AWS_KEY_ID, secretAccessKey: process.env.LILYTRAP_DECOY_AWS_SECRET } : void 0;
  const host = args.hostname ?? osHostname2();
  const out = await plant({ root: args.root, endpoint: args.endpoint, hostname: host, seed: args.seed, awsKey, ignore: args.ignore });
  if (!out.written.length) throw new Error(`nothing planted: every decoy path under ${args.root} already exists or is ignored`);
  await registerBuild(args.api, args.apiKey, out.manifest);
  const state = {
    version: 1,
    api: args.api,
    buildId: out.manifest.buildId,
    hostname: host,
    root: resolve2(args.root),
    ingestKey: out.ingestKey,
    files: out.files,
    plantedAt: out.manifest.createdAt
  };
  await mkdir3(dirname4(args.state), { recursive: true, mode: 448 });
  await writeFile5(args.state, `${JSON.stringify(state, null, 2)}
`, { mode: 384 });
  await chmod2(args.state, 384);
  console.log(`lilytrap: planted ${out.manifest.tokens.length} decoys on ${host} (deployment ${out.manifest.buildId})`);
  for (const f of out.written) console.log(`  + ${f}`);
  console.log(`  state -> ${args.state}`);
  console.log("  Using any of these is detected with nothing else installed. To also detect reads: lilytrap watch");
}
function parseAuditLines(lines, watched, key = "lilytrap") {
  const bySerial = /* @__PURE__ */ new Map();
  for (const line of lines) {
    const head = /^type=(\w+) msg=audit\((\d+)\.(\d+):(\d+)\):\s*(.*)$/.exec(line.trim());
    if (!head) continue;
    const [, type, sec, ms, serial, rest] = head;
    const fields = Object.fromEntries([...rest.matchAll(/(\w+)=("[^"]*"|\S+)/g)].map((m) => [m[1], m[2].replace(/^"|"$/g, "")]));
    const entry = bySerial.get(serial) ?? { paths: [], ts: new Date(Number(sec) * 1e3 + Number(ms.slice(0, 3))).toISOString() };
    if (type === "SYSCALL") entry.syscall = fields;
    if (type === "PATH" && fields.name) entry.paths.push(decodeAuditString(fields.name));
    bySerial.set(serial, entry);
  }
  const out = [];
  for (const { syscall, paths, ts } of bySerial.values()) {
    if (!syscall || syscall.key !== key) continue;
    for (const path of paths) {
      if (!watched.has(path)) continue;
      out.push({ path, ts, uid: num(syscall.uid), pid: num(syscall.pid), exe: syscall.exe ? decodeAuditString(syscall.exe) : void 0 });
    }
  }
  return out;
}
var decodeAuditString = (v) => /^[0-9A-F]+$/.test(v) && v.length % 2 === 0 && v.length > 2 ? Buffer.from(v, "hex").toString("utf8") : v;
var num = (v) => v === void 0 || Number.isNaN(Number(v)) ? void 0 : Number(v);
var has = (cmd) => {
  try {
    execFileSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
async function runWatch(statePath, opts = {}) {
  if (!existsSync5(statePath)) throw new Error(`no decoys planted (${statePath} missing). Run lilytrap plant first.`);
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const watched = new Set(state.files);
  const isRoot = process.getuid?.() === 0;
  const mode = opts.mode ?? (isRoot && has("auditctl") ? "auditd" : has("inotifywait") ? "inotify" : "none");
  const heartbeat = () => sendHeartbeat(state).catch((err) => console.error(`lilytrap: heartbeat failed: ${err.message}`));
  if (mode === "auditd" || mode === "inotify") {
    void heartbeat();
    setInterval(heartbeat, HEARTBEAT_MS).unref();
  }
  const pending = [];
  let timer = null;
  const report = (opens) => {
    pending.push(...opens);
    timer ??= setTimeout(() => {
      timer = null;
      const events = pending.splice(0, pending.length);
      sendOpens(state, events).catch((err) => console.error(`lilytrap: report failed: ${err.message}`));
    }, 2e3);
  };
  if (mode === "auditd") {
    for (const f of state.files) execFileSync("auditctl", ["-w", f, "-p", "r", "-k", "lilytrap"], { stdio: "ignore" });
    const log = opts.auditLog ?? "/var/log/audit/audit.log";
    console.log(`lilytrap: watching ${state.files.length} decoys with auditd (${log})`);
    const tail = spawn("tail", ["-F", "-n", "0", log], { stdio: ["ignore", "pipe", "inherit"] });
    let batch = [];
    createInterface({ input: tail.stdout }).on("line", (line) => {
      batch.push(line);
      if (line.startsWith("type=PROCTITLE") || line.startsWith("type=EOE") || batch.length > 200) {
        const opens = parseAuditLines(batch, watched);
        batch = [];
        if (opens.length) report(opens);
      }
    });
    await new Promise((r) => tail.on("exit", r));
    return;
  }
  if (mode === "inotify") {
    console.log(`lilytrap: watching ${state.files.length} decoys with inotify (no user or process details; run as root with auditd for those)`);
    const proc = spawn("inotifywait", ["-m", "-q", "-e", "open", "--format", "%w%f", ...state.files], { stdio: ["ignore", "pipe", "inherit"] });
    createInterface({ input: proc.stdout }).on("line", (path) => {
      if (watched.has(path)) report([{ path, ts: (/* @__PURE__ */ new Date()).toISOString() }]);
    });
    await new Promise((r) => proc.on("exit", r));
    return;
  }
  throw new Error("no file watcher available: run as root with auditd (auditctl), or install inotify-tools. Using a decoy is still detected without a watcher.");
}
var HEARTBEAT_MS = 6 * 60 * 60 * 1e3;
async function sendHeartbeat(state) {
  const res = await fetch(`${state.api.replace(/\/+$/, "")}/ingest/v1/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-lilytrap-ingest-key": state.ingestKey },
    body: "{}"
  });
  if (!res.ok) throw new Error(`heartbeat responded ${res.status}`);
}
async function sendOpens(state, events) {
  if (!events.length) return;
  const res = await fetch(`${state.api.replace(/\/+$/, "")}/ingest/v1/host`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-lilytrap-ingest-key": state.ingestKey },
    body: JSON.stringify({ hostname: state.hostname, events })
  });
  if (!res.ok) throw new Error(`ingest responded ${res.status}`);
  console.log(`lilytrap: reported ${events.length} decoy open(s)`);
}

// packages/cli/src/rules.ts
import { existsSync as existsSync6 } from "node:fs";
import { readFile as readFile4 } from "node:fs/promises";
import { join as join5, relative as relative2 } from "node:path";
async function loadRules(src) {
  const parts = [];
  const local = [];
  const file = src.file ?? src.defaults.find((f) => existsSync6(f));
  if (src.file && !existsSync6(src.file)) throw new Error(`--ignore-file ${src.file} doesn't exist`);
  if (file) {
    const patterns = parseIgnoreFile(await readFile4(file, "utf8"));
    local.push(...patterns);
    parts.push(`${patterns.length} from ${relative2(process.cwd(), file) || file}`);
  }
  local.push(...src.patterns);
  if (src.patterns.length) parts.push(`${src.patterns.length} from --ignore`);
  for (const p of local) {
    const problem = ignorePatternProblem(p);
    if (problem) throw new Error(`ignore pattern ${JSON.stringify(p)}: ${problem}`);
  }
  let workspace;
  if (src.api) {
    const policy = await fetchPolicy(src.api.url, src.api.credential, src.api.workspace);
    if (policy === null) console.warn("lilytrap: this Lilytrap API doesn't serve workspace ignore rules yet; using local rules only");
    else {
      workspace = compileIgnore(policy.ignore);
      if (policy.ignore.length) parts.push(`${policy.ignore.length} from the workspace`);
    }
  }
  return { ignore: anyIgnores(workspace, compileIgnore(local)), summary: parts.join(", ") };
}
var defaultIgnoreFiles = (dir) => [join5(process.cwd(), ".lilyignore"), ...dir ? [join5(dir, ".lilyignore")] : []];

// packages/cli/src/index.ts
var HELP = `lilytrap: plant LLM-bait breadcrumbs in your build and catch whoever follows them

Usage:
  lilytrap inject --path <dir> [--endpoint <trap-url>] [options]
  lilytrap plant [--root <dir>] [--rotate]
  lilytrap watch
  lilytrap config pull|apply|validate [--file lilytrap.json] [--dry-run]
  lilytrap ignore check <path>... [--ignore-file <f>] [--ignore <pattern>]
  lilytrap collector [options]
  lilytrap demo

.lilyignore: paths Lilytrap must never write to, in .gitignore syntax. inject reads it from the
working directory (the repo root in CI); plant from the working directory, then --root. The
workspace's own rules (lilytrap config, or the dashboard) always apply on top and can't be
re-included locally.
  --ignore-file <file>   use this file instead
  --ignore <pattern>     extra pattern; repeatable

config: the workspace's alerts, internal identities and ignore rules as a file. Needs
LILYTRAP_API_KEY. Keys left out of the file are left alone; null clears. Strings may use \${ENV}.
  pull                   write the current config (--file - for stdout)
  apply                  make the workspace match the file (--dry-run to preview)
  validate               check the file offline
  --file <path>          default lilytrap.json

plant: decoy credentials on a machine (kubeconfig, git and registry credentials, an admin env
file, an on-call handoff note). Never overwrites existing files. Needs LILYTRAP_API_KEY.
  --root <dir>           where to plant (default: your home directory)
  --api <url>            default https://api.lilytrap.com
  --rotate               remove the previous decoys (from the state file) and plant fresh ones
  --state <file>         default /var/lib/lilytrap/state.json as root, else ~/.lilytrap/state.json
  --hostname <name>      how this machine shows up in alerts
  Optional: LILYTRAP_DECOY_AWS_KEY_ID / LILYTRAP_DECOY_AWS_SECRET plant the permissionless AWS key
  from the Terraform module as a break-glass profile.

watch: report when a planted decoy file is opened (Linux: auditd as root, or inotify-tools).
Also checks in every 6 hours, so the dashboard can tell when a host has gone away.
  --state <file>  --mode auditd|inotify

inject options:
  --target web|files     web = built JS app (default), files = drop into any packaged dir
  --path <dir>           built artifact directory (e.g. dist/)
  --endpoint <url>       trap base URL the lures point at (default: looked up from --api)
  --density low|medium|high
  --api <url>            collector control API to register the build with
  --api-key <key>        (or LILYTRAP_API_KEY); GitHub OIDC token in LILYTRAP_OIDC_TOKEN takes precedence
  --workspace <id>       workspace id (required with OIDC)
  --out <file>           manifest path (default lilytrap-manifest.json). Keep it OUT of the artifact.
  --seed <hex>           reproduce a previous build's lures
  --ignore, --ignore-file  see .lilyignore above
  --deployment <key>     what this is a build of, so builds group into one deployment
                         (default in GitHub Actions: ci:<repo>:<workflow file>:<path>)

collector options:
  --port <n>             trap port (default 8787)
  --api-port <n>         control API port (default 8788)
  --data <dir>           data dir (default .lilytrap-data)
  --api-key <key>        (or LILYTRAP_API_KEY)
  --slack-webhook <url>  (or LILYTRAP_SLACK_WEBHOOK)
  --webhook <url> --webhook-secret <s>
  --trust-proxy          use x-forwarded-for for the client IP
`;
var { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    target: { type: "string", default: "web" },
    path: { type: "string" },
    endpoint: { type: "string" },
    density: { type: "string", default: "medium" },
    api: { type: "string" },
    "api-key": { type: "string" },
    workspace: { type: "string" },
    out: { type: "string", default: "lilytrap-manifest.json" },
    seed: { type: "string" },
    port: { type: "string", default: "8787" },
    "api-port": { type: "string", default: "8788" },
    data: { type: "string", default: ".lilytrap-data" },
    "slack-webhook": { type: "string" },
    webhook: { type: "string" },
    "webhook-secret": { type: "string" },
    "trust-proxy": { type: "boolean", default: false },
    root: { type: "string" },
    state: { type: "string" },
    rotate: { type: "boolean", default: false },
    hostname: { type: "string" },
    mode: { type: "string" },
    ignore: { type: "string", multiple: true, default: [] },
    "ignore-file": { type: "string" },
    file: { type: "string", default: "lilytrap.json" },
    "dry-run": { type: "boolean", default: false },
    deployment: { type: "string" },
    help: { type: "boolean", short: "h" }
  }
});
var apiKey = values["api-key"] ?? process.env.LILYTRAP_API_KEY;
async function runInject() {
  if (!values.path) throw new Error("--path is required");
  values.endpoint ??= values.api ? await trapUrlFrom(values.api) : void 0;
  if (!values.endpoint) throw new Error("--endpoint is required (or pass --api to look it up)");
  const target = values.target;
  if (target !== "web" && target !== "files") throw new Error(`unknown --target ${target}`);
  const artifact = resolve3(values.path);
  const out = resolve3(values.out);
  if (!relative3(artifact, out).startsWith("..")) throw new Error("--out must be outside the artifact; the manifest must never ship");
  const credential = process.env.LILYTRAP_OIDC_TOKEN || apiKey;
  const workspace = values.workspace ?? process.env.LILYTRAP_WORKSPACE;
  const rules = await loadRules({
    file: values["ignore-file"],
    defaults: defaultIgnoreFiles(),
    patterns: values.ignore,
    api: values.api ? { url: values.api, credential, workspace } : void 0
  });
  if (rules.summary) console.log(`lilytrap: ignore rules: ${rules.summary}`);
  const { manifest, result } = await inject({
    target,
    path: artifact,
    endpoint: values.endpoint,
    density: values.density,
    seed: values.seed,
    repo: process.env.GITHUB_REPOSITORY,
    commit: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    ignore: rules.ignore,
    deploymentKey: values.deployment ?? (process.env.GITHUB_REPOSITORY ? ciDeploymentKey(process.env.GITHUB_REPOSITORY, process.env.GITHUB_WORKFLOW_REF, values.path) : void 0)
  });
  if (!manifest.tokens.length) {
    console.warn(`lilytrap: nothing planted in ${values.path}: every place a decoy could go is ignored. Nothing registered.`);
    return;
  }
  await writeFile6(out, `${JSON.stringify(manifest, null, 2)}
`);
  console.log(`lilytrap: planted ${manifest.tokens.length} decoy tokens in ${values.path} (build ${manifest.buildId})`);
  for (const f of result.written) console.log(`  + ${f}`);
  for (const f of result.patched) console.log(`  ~ ${f}`);
  console.log(`  manifest -> ${relative3(process.cwd(), out)}`);
  if (values.api) {
    await registerBuild(values.api, credential, manifest, workspace);
    console.log(`  registered with ${values.api}`);
  }
}
async function runIgnoreCheck(paths) {
  if (!paths.length) throw new Error("usage: lilytrap ignore check <path>...");
  const api = values.api ?? (apiKey ? "https://api.lilytrap.com" : void 0);
  const rules = await loadRules({ file: values["ignore-file"], defaults: defaultIgnoreFiles(), patterns: values.ignore, api: api ? { url: api, credential: apiKey } : void 0 });
  console.log(`lilytrap: ignore rules: ${rules.summary || "none"}`);
  let any = false;
  for (const p of paths) {
    const ignored = rules.ignore.ignores(p);
    any ||= ignored;
    const by = ignored ? rules.ignore.patterns.filter((pat) => !pat.startsWith("!") && compileIgnore([pat]).ignores(p)) : [];
    console.log(`  ${ignored ? "ignored" : "allowed"}  ${p}${by.length ? `  (${by.join(", ")})` : ""}`);
  }
  if (any) process.exitCode = 1;
}
async function trapUrlFrom(api) {
  const res = await fetch(`${api.replace(/\/+$/, "")}/agent/v1/config`).catch(() => null);
  if (!res?.ok) return void 0;
  return (await res.json()).trapUrl ?? void 0;
}
async function runCollector() {
  const { createCollector: createCollector2 } = await Promise.resolve().then(() => (init_collector(), collector_exports));
  const { trap, api } = await createCollector2({
    dataDir: values.data,
    apiKey,
    trustProxy: values["trust-proxy"],
    alerts: withoutEmpty({
      slackWebhook: values["slack-webhook"] ?? process.env.LILYTRAP_SLACK_WEBHOOK,
      webhookUrl: values.webhook,
      webhookSecret: values["webhook-secret"]
    }),
    tarpitMs: [400, 1500],
    // Advertised on /v1/config so plant, the Terraform provider and agents find the local trap.
    trapUrl: values.endpoint ?? `http://localhost:${values.port}`,
    apiUrl: `http://127.0.0.1:${values["api-port"]}`
  });
  if (!apiKey) console.warn("lilytrap: no --api-key set; control API is open (fine for local dev only)");
  trap.listen(Number(values.port), () => console.log(`lilytrap: trap listening on :${values.port}`));
  api.listen(Number(values["api-port"]), "127.0.0.1", () => console.log(`lilytrap: control API on 127.0.0.1:${values["api-port"]}`));
}
var withoutEmpty = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== void 0 && v !== ""));
async function runDemo() {
  const repoRoot = resolve3(dirname5(fileURLToPath(import.meta.url)), "../../..");
  const work = join6(repoRoot, ".lilytrap-demo");
  await rm2(work, { recursive: true, force: true });
  await mkdir4(work, { recursive: true });
  await cp(join6(repoRoot, "examples/demo-web/dist"), join6(work, "dist"), { recursive: true });
  values.data = join6(work, "data");
  await runCollector();
  await new Promise((r) => setTimeout(r, 200));
  values.path = join6(work, "dist");
  values.out = join6(work, "lilytrap-manifest.json");
  values.endpoint = `http://localhost:${values.port}`;
  values.api = `http://127.0.0.1:${values["api-port"]}`;
  await runInject();
  console.log(`
Lures planted in ${relative3(process.cwd(), values.path)}. Point an agent at it, e.g.:

  "Here is a production web bundle. Find any way to access other customers' data."

Hits will print here. Events: curl ${values.api}/v1/events
Dashboard: pnpm --filter @lilytrap/dashboard dev  ->  http://localhost:5173
`);
}
try {
  const cmd = positionals[0];
  if (values.help || !cmd) console.log(HELP);
  else if (cmd === "inject") await runInject();
  else if (cmd === "plant") {
    const api = values.api ?? "https://api.lilytrap.com";
    const endpoint = values.endpoint ?? await trapUrlFrom(api);
    if (!endpoint) throw new Error(`couldn't look up the trap URL from ${api}; pass --endpoint`);
    const root = values.root ?? homedir2();
    const rules = await loadRules({ file: values["ignore-file"], defaults: defaultIgnoreFiles(root), patterns: values.ignore, api: apiKey ? { url: api, credential: apiKey } : void 0 });
    if (rules.summary) console.log(`lilytrap: ignore rules: ${rules.summary}`);
    await runPlant({ root, api, endpoint, apiKey, state: values.state ?? defaultStatePath(), rotate: values.rotate, hostname: values.hostname, seed: values.seed, ignore: rules.ignore });
  } else if (cmd === "watch") await runWatch(values.state ?? defaultStatePath(), { mode: values.mode });
  else if (cmd === "config") {
    await runConfig({ action: positionals[1], file: values.file, api: values.api ?? "https://api.lilytrap.com", apiKey, dryRun: values["dry-run"] });
  } else if (cmd === "ignore" && positionals[1] === "check") await runIgnoreCheck(positionals.slice(2));
  else if (cmd === "collector") await runCollector();
  else if (cmd === "demo") await runDemo();
  else throw new Error(`unknown command ${cmd}`);
} catch (err) {
  console.error(`lilytrap: ${err.message}`);
  process.exit(1);
}
