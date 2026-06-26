# Jiawei Fu Personal Site — Cloudflare Version

This is a clean Cloudflare-native replacement for the old Railway/Express version.

## Structure

```text
public/index.html              Static frontend and admin UI
public/_redirects              SPA fallback for /admin, /post/:id, etc.
functions/api/[[path]].js      Cloudflare Pages Functions backend
functions/api/*                Handles /api/me, /api/login, /api/posts, /api/about
db/schema.sql                  Optional D1 schema you can run manually
package.json                   No build step needed
```

## Cloudflare Pages settings

Use these build settings:

```text
Framework preset: None
Build command: npm run build, or leave empty
Build output directory: public
Root directory: /
Production branch: main
```

## Required Cloudflare settings

In your Pages project, add a D1 binding:

```text
Settings → Bindings → Add → D1 database
Variable name: DB
Database: your D1 database
```

Then add environment variables:

```text
ADMIN_PASSWORD=your_admin_password
SESSION_SECRET=a_long_random_secret_string
```

You do not need `DATABASE_URL` anymore.

## How to use

After deploying, test:

```text
https://jiaweifu.com/api/me
```

Expected response before login:

```json
{"admin":false}
```

Then open:

```text
https://jiaweifu.com/admin
```

Log in with `ADMIN_PASSWORD`, create a test post, refresh, and confirm it stays saved.

## API routes

```text
GET    /api/me
POST   /api/login
POST   /api/logout
GET    /api/posts
GET    /api/posts?type=blog
GET    /api/posts?type=trade
GET    /api/posts?type=recap
GET    /api/posts/:id
POST   /api/posts
PUT    /api/posts/:id
DELETE /api/posts/:id
GET    /api/about
PUT    /api/about
```

## Notes

The API automatically creates the D1 tables if they do not exist, so `db/schema.sql` is optional. It is included in case you prefer to initialize the database manually from the Cloudflare D1 console.
