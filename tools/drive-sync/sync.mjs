// Sync release assets to the Bonkey Apps Google Drive (bonkey.apps@gmail.com).
//
// Authenticates as the Drive owner via an OAuth refresh token (so uploaded
// files are owned by that account and land in My Drive without service-account
// quota limits), then mirrors each local directory in `manifest.json` into the
// matching Drive subfolder — creating subfolders as needed and UPDATING files
// that already exist (matched by name) so re-runs don't create duplicates.
//
// Env (from repo secrets/variables — see docs/release/google-drive-sync.md):
//   GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN  (secrets)
//   GDRIVE_ROOT_FOLDER_ID  (optional; overrides manifest.rootFolderId)
//
// No npm dependencies — uses Node's built-in fetch (Node 18+).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const manifest = JSON.parse(readFileSync(path.join(HERE, "manifest.json"), "utf8"));

const CLIENT_ID = process.env.GDRIVE_CLIENT_ID;
const CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GDRIVE_REFRESH_TOKEN;
const ROOT = process.env.GDRIVE_ROOT_FOLDER_ID || manifest.rootFolderId;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.log("⏭  Google Drive credentials not set — skipping sync (this is not an error).");
  process.exit(0);
}
if (!ROOT) {
  console.error("✗ No Drive root folder id (set GDRIVE_ROOT_FOLDER_ID or manifest.rootFolderId).");
  process.exit(1);
}

const MIME = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".txt": "text/plain", ".pdf": "application/pdf" };
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

let accessToken;
async function getToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: REFRESH_TOKEN, grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}
async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { authorization: `Bearer ${accessToken}`, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${url} → ${res.status} ${await res.text()}`);
  return res;
}
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function findChild(name, parent, folderOnly) {
  const clauses = [`name='${esc(name)}'`, `'${parent}' in parents`, "trashed=false"];
  if (folderOnly) clauses.push("mimeType='application/vnd.google-apps.folder'");
  const q = encodeURIComponent(clauses.join(" and "));
  const res = await api(`${DRIVE}?q=${q}&fields=files(id,name)&pageSize=1`);
  return (await res.json()).files[0]?.id || null;
}
async function ensureFolder(name, parent) {
  const found = await findChild(name, parent, true);
  if (found) return found;
  const res = await api(`${DRIVE}?fields=id`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }),
  });
  return (await res.json()).id;
}
async function uploadFile(localPath, name, parent) {
  const body = readFileSync(localPath);
  const mime = MIME[path.extname(name).toLowerCase()] || "application/octet-stream";
  const existing = await findChild(name, parent, false);
  if (existing) {
    await api(`${UPLOAD}/${existing}?uploadType=media`, { method: "PATCH", headers: { "content-type": mime }, body });
    return "updated";
  }
  const boundary = "bonkey-drive-sync-boundary";
  const meta = JSON.stringify({ name, parents: [parent] });
  const pre = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
  const post = Buffer.from(`\r\n--${boundary}--`);
  await api(`${UPLOAD}?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body: Buffer.concat([pre, body, post]),
  });
  return "created";
}

async function main() {
  accessToken = await getToken();
  let created = 0, updated = 0, missing = 0;
  for (const { dir, folder } of manifest.mappings) {
    const localDir = path.join(REPO, dir);
    let files;
    try {
      files = readdirSync(localDir).filter((f) => statSync(path.join(localDir, f)).isFile() && !f.startsWith("."));
    } catch {
      console.log(`•  ${dir} — not present, skipping`);
      missing++;
      continue;
    }
    if (!files.length) { console.log(`•  ${dir} — empty, skipping`); continue; }
    const folderId = await ensureFolder(folder, ROOT);
    for (const f of files.sort()) {
      const outcome = await uploadFile(path.join(localDir, f), f, folderId);
      if (outcome === "created") created++;
      else updated++;
      console.log(`   ${outcome === "created" ? "＋" : "↻"} ${folder}/${f}`);
    }
    console.log(`✓  ${dir} → ${folder}`);
  }
  console.log(`\nDone: ${created} created, ${updated} updated${missing ? `, ${missing} dir(s) absent` : ""}.`);
}

main().catch((e) => { console.error("✗ Drive sync failed:", e.message); process.exit(1); });
