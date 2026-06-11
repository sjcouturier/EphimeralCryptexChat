# Ephemeral Cryptex Chat

A cyberpunk-themed, end-to-end encrypted, turn-based ephemeral chat app.  
Messages arrive scrambled, decrypt on demand, then disappear forever.  
Context lives only in your mind.

---

## What it is

- **Turn-based** — one message in play per channel at a time
- **Ephemeral** — messages auto-delete after delivery; the UI clears them after you read them
- **E2E encrypted** — ECDH key exchange + AES-GCM in the browser; the server only ever sees ciphertext
- **Multiple channels** — maintain independent conversations with different people simultaneously
- **Cyberpunk UI** — neon cyan/magenta, scramble/reveal animation, Web Audio sound layer
- **PWA** — installable on any device via "Add to Home Screen"; no app store required

---

## Stack

| Layer | Technology |
|---|---|
| Backend | ASP.NET Core 10 · SignalR · EF Core (SQLite) · GitHub OAuth · JWT |
| Frontend | Angular 21 · Signals · WebCrypto API · Custom CSS · PWA |
| Deployment | Backend → Render.com · Frontend → GitHub Pages |

---

## Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js 24+](https://nodejs.org/) and npm
- [Angular CLI 21](https://angular.dev/tools/cli): `npm install -g @angular/cli`
- A [GitHub account](https://github.com) for OAuth

---

## First-time setup

### 1. Create a GitHub OAuth App

Go to **https://github.com/settings/developers** → OAuth Apps → **New OAuth App**

| Field | Value |
|---|---|
| Application name | `EphemeralCryptexChat (local)` |
| Homepage URL | `http://localhost:4200` |
| Authorization callback URL | `http://localhost:5058/signin-github` |

Copy the **Client ID** and generate a **Client Secret**.

### 2. Configure secrets (never commit these)

```bash
cd api
dotnet user-secrets init
dotnet user-secrets set "GitHub:ClientId"     "YOUR_CLIENT_ID"
dotnet user-secrets set "GitHub:ClientSecret" "YOUR_CLIENT_SECRET"
dotnet user-secrets set "Jwt:Key"             "any-random-string-32-chars-or-more"
```

The database (`ephemeral_cryptex.db`) is created and migrated automatically on first run.

---

## Running locally

### Option A — Visual Studio 2026

1. Open `EphemeralCryptexChat.slnx`
2. Right-click solution → **Configure Startup Projects** → **Multiple startup projects**
3. Set both `EphemeralCryptexChat.Api` and `EphemeralCryptexChat.Client` to **Start**
4. Press **F5**

TypeScript breakpoints work in the Angular client; C# breakpoints work in the API.

### Option B — Terminal

```bash
# Terminal 1 — API (http://localhost:5058 · https://localhost:7281)
cd api
dotnet run

# Terminal 2 — Angular dev server (http://localhost:4200)
cd client
npm start
```

---

## Testing

### Solo (chatting with yourself)

1. Log in with your GitHub account
2. Click **+ NEW CHANNEL**, enter **your own GitHub username**
3. Compose a message → **TRANSMIT**
4. The message echoes back as a scrambled incoming bubble
5. Tap the bubble → decrypt animation plays → read window → message disappears
6. Compose panel appears for your reply

This is the quickest way to experience the full scramble/reveal/disappear cycle.

### With a second user (recommended for real testing)

The app is designed for two people. To test with a second identity:

- **Incognito window** — open `http://localhost:4200` in an incognito/private window and log in with a **different GitHub account**
- **Second device** — log in on a phone or another computer on the same network (point at your machine's IP on port 5058/4200, ensuring CORS allows it)
- **Friend or colleague** — once deployed, share the GitHub Pages URL and have them log in

When both users are in the same channel, you'll see:
- Real-time "YOUR TURN / AWAITING..." status switching
- Browser push notifications when a message arrives
- The full turn-based encryption loop

---

## How the encryption works

1. On first login, your browser generates an **ECDH P-256 key pair** and stores it in IndexedDB  
   *(the private key is non-extractable and never leaves your device)*
2. Your public key is registered with the server alongside your GitHub identity
3. When you open a channel with someone, your browser fetches **their** public key
4. Using ECDH, both sides independently derive an identical **AES-GCM shared secret**  
   *(the secret is never transmitted — only the public keys are)*
5. Every message is encrypted with AES-GCM before leaving your device
6. The server stores and relays only **ciphertext blobs** — it cannot read your messages

**Key lifecycle:** Keys are bound to this browser on this device. Clearing browser storage or using a new device generates a new key pair automatically.

---

## Security model

This app provides **two layers of privacy**:

| Layer | What it protects |
|---|---|
| E2E encryption | Messages in transit and at rest on the server |
| Ephemeral UI | Casual shoulder-surfing, glances, lingering plaintext on screen |

**It does NOT protect against:** compromised devices, OS-level attackers, or someone photographing your screen during the read window.  
**The server never sees plaintext.** Even if the server is fully compromised, your messages remain encrypted.

---

## Deployment

See the [hosting discussion](docs/hosting.md) *(coming soon)* for step-by-step instructions to deploy to:
- **Backend** → [Render.com](https://render.com) (free tier available)
- **Frontend** → [GitHub Pages](https://pages.github.com)

CI/CD is configured in `.github/workflows/` — push to `main` triggers automatic deploys.

---

## Project structure

```
EphemeralCryptexChat/
├── api/                    # ASP.NET Core 10 Web API
│   ├── Controllers/        # Auth, Users, Conversations, Messages
│   ├── Hubs/               # SignalR ChatHub
│   ├── Models/             # User, Conversation, Message, CryptoKeyRecord
│   ├── Services/           # Business logic + interfaces
│   ├── Data/               # EF Core DbContext + Migrations
│   └── DTOs/               # Request/response objects
├── client/                 # Angular 21 PWA
│   └── src/app/
│       ├── core/           # Services, guards, models, state (Signals)
│       ├── features/       # Auth, Channels, Chat, Playground, Manual
│       └── shared/         # ScrambleText, AmbientBackground, Typewriter
└── .github/workflows/      # CI/CD: api-deploy.yml, client-deploy.yml
```

---

## Routes

| URL | Screen |
|---|---|
| `/login` | GitHub OAuth login (cyberpunk splash) |
| `/channels` | Active Channels hub |
| `/chat/:id` | Conversation stage (single message in play) |
| `/playground` | Decryption Playground — solo animation toy |
| `/manual` | System Manual — classified terminal–style help |
