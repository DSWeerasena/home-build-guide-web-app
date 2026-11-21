# House Build Guide

**Smart House Construction Quantity Estimation System** — a bilingual (English / සිංහල) web app that helps first-time homeowners in Sri Lanka plan construction stages and estimate material quantities for Foundation, Brickwork and Cement Works (columns, beams, lintels, slab, flooring, plastering, stair case and reinforcement steel).

## Architecture

```
Browser
  │
  ▼
React + Vite website ───────────────► Firebase Authentication  (accounts, email verification, password reset)
(repository root, hosted on Vercel)
  │  HTTPS + "Authorization: Bearer <Firebase ID token>"
  ▼
Node.js + Express API  (server/, hosted on Render)
  │  Firebase Admin SDK — verifies every token and checks project ownership
  ├────────────► Cloud Firestore   users/{uid}, projects/{projectId}, projects/{projectId}/calculations/{id}, …/plans/{id}
  └────────────► Firebase Storage  users/{uid}/projects/{projectId}/plans/{planId}.{png|jpg|pdf}  (private)
```

* The **website never talks to Firestore or Storage directly**. All reads and writes go through the API, which takes the user id only from the verified Firebase token and refuses (403) any project the user does not own.
* Every calculation is its own Firestore document with a unique id, so editing updates that document and nothing is ever overwritten.
* Uploaded house plans are stored privately in Firebase Storage; the browser only receives links that expire after one hour.
* **Local mode:** if the Firebase settings are not filled in, the website still runs exactly as before — data is kept in the browser and the login is a demo. This keeps the Figma Make preview working.
* **One-time import:** when someone signs in on a browser that holds a project from local mode, they are asked whether to import it into their account. The browser copy is never deleted.

## Repository layout

```
├── src/                  React app (Figma Make expects it at the root)
│   ├── auth/             Firebase Authentication provider
│   ├── cloud/            loads and auto-saves the signed-in user's project through the API
│   ├── lib/              Firebase web setup, API helper, project <-> record conversion
│   ├── i18n/             English and Sinhala text
│   └── utils/            calculation formulas (unchanged by deployment)
├── tests/                frontend unit tests (npm test)
├── server/               Express API (deployed separately to Render)
│   ├── src/{routes,controllers,middleware,services}
│   ├── test/             API tests with in-memory Firebase stand-ins (npm test)
│   └── .env.example
├── firestore.rules       Firestore security rules
├── storage.rules         Storage security rules
├── firebase.json         lets the Firebase CLI deploy the two rule files
├── vercel.json           Vercel build + SPA routing
├── render.yaml           Render Blueprint for the API
└── .env.example          website settings (public Firebase web config + API URL)
```

## Local development

Requirements: Node.js 22 and npm.

```bash
# 1. Website
npm install
cp .env.example .env.local          # fill in, or leave empty for local mode
npm run dev                         # http://localhost:8443 (set PORT=5173 to use 5173)

# 2. API (only needed for cloud mode)
cd server
npm install
cp .env.example .env                # fill in the Firebase Admin values
npm run dev                         # http://localhost:5000  (check http://localhost:5000/health)
```

For local cloud mode set `VITE_API_URL=http://localhost:5000` in `.env.local`. The API already accepts requests from `localhost:5173`, `localhost:8443` and `localhost:4173` when `NODE_ENV` is not `production`.

Tests:

```bash
npm test              # calculations, translations, cloud sync conversion
npm run test:api      # API security, ownership, validation, uploads, account deletion
npm run build         # production build into dist/
```

## Environment variables

Never commit real values. `.gitignore` excludes `.env`, `.env.*`, `server/.env` and Firebase service-account files, but keeps the two `.env.example` templates.

### Website (`.env.local` locally, Vercel → Settings → Environment Variables in production)

| Variable | Where to find it |
|---|---|
| `VITE_API_URL` | Your Render URL, e.g. `https://house-build-guide-api.onrender.com` (no trailing slash) |
| `VITE_FIREBASE_API_KEY` … `VITE_FIREBASE_APP_ID` | Firebase Console → Project settings → General → Your apps → Web app → config |

These are public browser settings. **Never** put the Admin private key here.

### API (`server/.env` locally, Render → Environment in production)

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` on Render, `development` locally |
| `FRONTEND_URL` | Your Vercel URL, e.g. `https://house-build-guide.vercel.app` (comma-separate several) |
| `FIREBASE_PROJECT_ID` | `project_id` from the service-account JSON |
| `FIREBASE_CLIENT_EMAIL` | `client_email` from the service-account JSON |
| `FIREBASE_PRIVATE_KEY` | `private_key` from the service-account JSON, including the `\n` sequences |
| `FIREBASE_STORAGE_BUCKET` | Storage bucket name, e.g. `your-project.firebasestorage.app` |
| `PORT` | Set automatically by Render; `5000` locally |

## API

All `/api` routes need `Authorization: Bearer <Firebase ID token>`; every `/api/projects/:projectId…` route also checks that the project belongs to that user.

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Public status check |
| POST | `/api/users/bootstrap` | Create profile + first project on first sign-in; record login |
| GET / PUT / DELETE | `/api/me` | Read / update (name, language) / delete account and all data |
| GET / POST | `/api/projects` | List / create own projects |
| GET / PUT / DELETE | `/api/projects/:projectId` | Read / update / delete a project (with its calculations and plans) |
| GET / POST | `/api/projects/:projectId/calculations` | List / create calculations |
| GET / PUT / DELETE | `/api/projects/:projectId/calculations/:calculationId` | Read / update in place (creates if new) / delete |
| GET / POST | `/api/projects/:projectId/foundation/plans` | List plans with signed links / upload a plan (JPG, PNG, PDF, max 10 MB) |
| DELETE | `/api/projects/:projectId/foundation/plans/:planId` | Delete a plan and its file |
| GET | `/api/projects/:projectId/report` | Latest calculations grouped by stage |

Security: Helmet headers, CORS limited to `FRONTEND_URL`, rate limiting, 512 kB JSON limit, field-by-field validation, upload type checked by MIME type + extension + file signature, generic error messages (details only in server logs, never tokens or keys).

---

# Deployment guide

Do these steps in order. Steps marked **You** need your own accounts.

## A. Firebase Console (You)

1. Go to <https://console.firebase.google.com> → **Add project** → name it (e.g. `house-build-guide`). Google Analytics is optional.
2. **Authentication** → **Get started** → **Sign-in method** → enable **Email/Password** → Save.
3. **Firestore Database** → **Create database** → **Start in production mode** → choose a location close to your users (e.g. `asia-south1` Mumbai) → Enable.
4. **Storage** → **Get started** → **Start in production mode** → same location.
   *Note: Firebase may ask you to upgrade to the **Blaze (pay-as-you-go)** plan before Storage can be created. Usage within the free allowance costs nothing, but a billing account must be attached. Set a budget alert in Google Cloud Billing if you upgrade.*
5. **Firestore Database → Rules**: replace everything with the contents of [`firestore.rules`](firestore.rules) → **Publish**.
6. **Storage → Rules**: replace everything with the contents of [`storage.rules`](storage.rules) → **Publish**.
7. **Project settings (gear) → General → Your apps** → click the **Web** icon (`</>`) → register an app (Hosting not needed) → copy the six values in `firebaseConfig` (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId). These go into Vercel in step D3.
8. **Project settings → Service accounts → Generate new private key** → a JSON file downloads.
   **Keep this file secret.** Do not put it in the project folder, email it or commit it. You will copy three values from it into Render in step C3, then you can delete the file.
9. Note the **Storage bucket name** shown at the top of the Storage page (without `gs://`).

## B. GitHub (You)

1. Install Git: <https://git-scm.com/download/win> (accept the defaults).
2. Create a **private** repository on <https://github.com/new> (e.g. `house-build-guide`), without a README.
3. In this project folder, open a terminal and run:

   ```bash
   git init
   git add .
   git status        # check: NO .env, .env.local, server/.env or *-firebase-adminsdk-*.json files listed
   git commit -m "House Build Guide: website + API"
   git branch -M main
   git remote add origin https://github.com/<your-username>/house-build-guide.git
   git push -u origin main
   ```

   The `.figma/` folder must be included (the build reads `.figma/make/site.json`).

## C. Render — the API (You)

1. Sign in at <https://render.com> with GitHub.
2. **New → Web Service** → select the repository, then:
   * **Root Directory:** `server`
   * **Runtime:** Node
   * **Build Command:** `npm ci --omit=dev`
   * **Start Command:** `npm start`
   * **Health Check Path:** `/health`
   * Instance type: Free is fine for testing.

   (Alternatively **New → Blueprint** uses [`render.yaml`](render.yaml) and asks for the secret values.)
3. **Environment** → add:
   * `NODE_ENV` = `production`
   * `NODE_VERSION` = `22`
   * `FRONTEND_URL` = `https://example.invalid` for now (you will replace it in step E1)
   * `FIREBASE_PROJECT_ID` = `project_id` from the JSON file
   * `FIREBASE_CLIENT_EMAIL` = `client_email` from the JSON file
   * `FIREBASE_PRIVATE_KEY` = `private_key` from the JSON file — copy everything between the quotes, from `-----BEGIN PRIVATE KEY-----` to `-----END PRIVATE KEY-----\n`
   * `FIREBASE_STORAGE_BUCKET` = the bucket name from step A9
4. **Create Web Service** and wait for "Live". Open `https://<your-service>.onrender.com/health` — it must show `{"status":"ok","service":"house-build-guide-api"}`.
5. Copy this URL — it is your `VITE_API_URL`.

   *The free plan sleeps after about 15 minutes without traffic; the first request afterwards can take up to a minute.*

## D. Vercel — the website (You)

1. Sign in at <https://vercel.com> with GitHub → **Add New → Project** → import the repository.
2. Settings (already provided by [`vercel.json`](vercel.json)): Framework **Vite**, Root Directory **`./`** (the repository root), Build Command `npm run build`, Output Directory `dist`.
3. **Environment Variables** (Production): add `VITE_API_URL` (from C5) and the six `VITE_FIREBASE_*` values (from A7).
4. **Deploy**. Your public link is shown, e.g. `https://house-build-guide.vercel.app`.

## E. Connect everything (You)

1. **Render → Environment**: set `FRONTEND_URL` to your exact Vercel URL (no trailing slash) → **Save, rebuild and deploy**. If you also want Vercel preview links to work, list them comma-separated.
2. **Firebase → Authentication → Settings → Authorized domains → Add domain**: your Vercel domain (e.g. `house-build-guide.vercel.app`). Add any custom domain later the same way.
3. If you change any `VITE_*` value in Vercel, **redeploy** the website (Vercel → Deployments → Redeploy) — Vite reads them only at build time.

## F. Final production test

Use a private/incognito window and a brand-new email address.

1. Open the Vercel link → landing page loads → switch to සිංහල → refresh → still Sinhala.
2. Register → you land on the Dashboard → a "verify your email" banner appears → verify from the email → click "I have verified".
3. Save **Brick Wall 01**, **Brick Wall 02**, **Cement Block 01**, **Column 01**, **Column 02**, **Beam 01**, **Stair Case 01** and a Foundation calculation with an uploaded plan. Watch "All changes saved".
4. Reports → **Edit** a brickwork calculation → change a measurement → Save. It must update the same entry (no duplicate).
5. Log out → close the browser → open the link → log in → everything (including the plan image) is back.
6. **Isolation:** register a second user in another browser → they see an empty project. Copying a project/calculation URL from user A does not give user B access (the API answers 403).
7. Forgot password sends an email; Profile → change name/language; Profile → Delete my account removes everything.
8. Check phone widths (375–430 px), tablet (768 px) and desktop (1440 px).

Share **only the Vercel link**. The Render URL is for the website, not for people.

## Optional extras

* **Custom domain:** Vercel → Project → Settings → Domains. Then add it to `FRONTEND_URL` on Render and to Firebase Authorized domains. An API subdomain (e.g. `api.housebuildguide.lk`) can be added in Render → Settings → Custom Domains; update `VITE_API_URL` and redeploy Vercel.
* **Demo account for examiners:** register a separate account (e.g. a dedicated email), add sample Foundation, Brickwork and Cement Works calculations, and share its login privately — never on the website.
* **Rules from the command line:** `npm install -g firebase-tools`, `firebase login`, `firebase use <project-id>`, `firebase deploy --only firestore:rules,storage`.

## Notes

* PDF reports are generated in English (the PDF library cannot shape Sinhala text); the on-screen Reports page is fully bilingual.
* The plan tracer works on JPG/PNG images. The API also accepts PDF plan files for storage.
* Quantities are estimates for planning; structural decisions must follow the approved plan and professional advice.
"# home-build-guide-web-app" 
