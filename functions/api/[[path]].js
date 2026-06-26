function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function empty(status = 204, extraHeaders = {}) {
  return new Response(null, { status, headers: extraHeaders });
}

function getCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  const parts = cookie.split(";").map((p) => p.trim());

  for (const part of parts) {
    if (part.startsWith(`${name}=`)) {
      return decodeURIComponent(part.slice(name.length + 1));
    }
  }

  return null;
}

async function hmac(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));

  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function makeAdminToken(env) {
  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = `admin:${expires}`;
  const signature = await hmac(env.SESSION_SECRET, payload);
  return `${expires}.${signature}`;
}

async function isAdmin(request, env) {
  const token = getCookie(request, "admin_token");
  if (!token) return false;

  const [expires, signature] = token.split(".");
  if (!expires || !signature) return false;

  const expiresNumber = Number(expires);
  if (!Number.isFinite(expiresNumber)) return false;
  if (Date.now() > expiresNumber) return false;

  const expectedSignature = await hmac(env.SESSION_SECRET, `admin:${expires}`);
  return safeEqual(signature, expectedSignature);
}

async function requireAdmin(request, env) {
  const ok = await isAdmin(request, env);
  if (!ok) return json({ error: "Unauthorized" }, 401);
  return null;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function cleanString(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.trim();
}

function nullableString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function nowIso() {
  return new Date().toISOString();
}

async function ensureSchema(env) {
  await env.DB.prepare(
    `
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      excerpt TEXT DEFAULT '',
      ticker TEXT,
      direction TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    `
  ).run();

  await env.DB.prepare(
    `
    CREATE TABLE IF NOT EXISTS about (
      id INTEGER PRIMARY KEY,
      content TEXT NOT NULL DEFAULT ''
    )
    `
  ).run();

  await env.DB.prepare(
    `
    INSERT OR IGNORE INTO about (id, content)
    VALUES (
      1,
      '# About Me\n\nHey, I''m Jiawei. This is where I write about markets, trading research, ideas, and notes.'
    )
    `
  ).run();
}

function normalizePost(row) {
  if (!row) return null;

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    excerpt: row.excerpt || "",
    ticker: row.ticker || null,
    direction: row.direction || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getApiPath(request) {
  const url = new URL(request.url);
  return url.pathname
    .replace(/^\/api\/?/, "")
    .split("/")
    .filter(Boolean);
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  const path = getApiPath(request);

  if (method === "OPTIONS") {
    return empty(204, {
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
  }

  if (!env.DB) {
    return json(
      { error: "Missing D1 binding. Bind your D1 database as DB in Cloudflare Pages settings." },
      500
    );
  }

  if (!env.ADMIN_PASSWORD) {
    return json({ error: "Missing ADMIN_PASSWORD environment variable." }, 500);
  }

  if (!env.SESSION_SECRET) {
    return json({ error: "Missing SESSION_SECRET environment variable." }, 500);
  }

  try {
    await ensureSchema(env);

    if (method === "GET" && path[0] === "me") {
      return json({ admin: await isAdmin(request, env) });
    }

    if (method === "POST" && path[0] === "login") {
      const body = await readJson(request);
      const password = typeof body.password === "string" ? body.password : "";

      if (!safeEqual(password, env.ADMIN_PASSWORD)) {
        return json({ error: "Wrong password" }, 401);
      }

      const token = await makeAdminToken(env);
      return json(
        { ok: true },
        200,
        {
          "set-cookie": `admin_token=${encodeURIComponent(
            token
          )}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
        }
      );
    }

    if (method === "POST" && path[0] === "logout") {
      return json(
        { ok: true },
        200,
        {
          "set-cookie": "admin_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        }
      );
    }

    if (method === "GET" && path[0] === "posts" && path.length === 1) {
      const type = url.searchParams.get("type");

      const result = type
        ? await env.DB.prepare(
            `
            SELECT *
            FROM posts
            WHERE type = ?
            ORDER BY created_at DESC, id DESC
            `
          )
            .bind(type)
            .all()
        : await env.DB.prepare(
            `
            SELECT *
            FROM posts
            ORDER BY created_at DESC, id DESC
            `
          ).all();

      return json((result.results || []).map(normalizePost));
    }

    if (method === "GET" && path[0] === "posts" && path[1]) {
      const id = Number(path[1]);
      if (!Number.isInteger(id)) return json({ error: "Invalid post id" }, 400);

      const row = await env.DB.prepare("SELECT * FROM posts WHERE id = ?")
        .bind(id)
        .first();

      if (!row) return json({ error: "Not found" }, 404);
      return json(normalizePost(row));
    }

    if (method === "POST" && path[0] === "posts" && path.length === 1) {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;

      const body = await readJson(request);
      const type = cleanString(body.type);
      const title = cleanString(body.title);
      const content = typeof body.content === "string" ? body.content.trim() : "";
      const excerpt = typeof body.excerpt === "string" ? body.excerpt.trim() : "";
      const ticker = nullableString(body.ticker);
      const direction = nullableString(body.direction);
      const timestamp = nowIso();

      if (!type || !title || !content) {
        return json({ error: "type, title, content required" }, 400);
      }

      const result = await env.DB.prepare(
        `
        INSERT INTO posts (type, title, content, excerpt, ticker, direction, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
        .bind(type, title, content, excerpt, ticker, direction, timestamp, timestamp)
        .run();

      return json({ id: result.meta?.last_row_id || null });
    }

    if (method === "PUT" && path[0] === "posts" && path[1]) {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;

      const id = Number(path[1]);
      if (!Number.isInteger(id)) return json({ error: "Invalid post id" }, 400);

      const existing = await env.DB.prepare("SELECT id FROM posts WHERE id = ?")
        .bind(id)
        .first();

      if (!existing) return json({ error: "Not found" }, 404);

      const body = await readJson(request);
      const title = cleanString(body.title);
      const content = typeof body.content === "string" ? body.content.trim() : "";
      const excerpt = typeof body.excerpt === "string" ? body.excerpt.trim() : "";
      const ticker = nullableString(body.ticker);
      const direction = nullableString(body.direction);
      const timestamp = nowIso();

      if (!title || !content) {
        return json({ error: "title and content required" }, 400);
      }

      await env.DB.prepare(
        `
        UPDATE posts
        SET title = ?, content = ?, excerpt = ?, ticker = ?, direction = ?, updated_at = ?
        WHERE id = ?
        `
      )
        .bind(title, content, excerpt, ticker, direction, timestamp, id)
        .run();

      return json({ ok: true });
    }

    if (method === "DELETE" && path[0] === "posts" && path[1]) {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;

      const id = Number(path[1]);
      if (!Number.isInteger(id)) return json({ error: "Invalid post id" }, 400);

      await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }

    if (method === "GET" && path[0] === "about") {
      const row = await env.DB.prepare("SELECT content FROM about WHERE id = 1").first();
      return json({ content: row?.content || "" });
    }

    if (method === "PUT" && path[0] === "about") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;

      const body = await readJson(request);
      const content = typeof body.content === "string" ? body.content : "";

      await env.DB.prepare(
        `
        INSERT INTO about (id, content)
        VALUES (1, ?)
        ON CONFLICT(id) DO UPDATE SET content = excluded.content
        `
      )
        .bind(content)
        .run();

      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json({ error: error?.message || String(error) }, 500);
  }
}
