# Copilot Instructions

## Quick Reference

**Tech Stack:** ASP.NET Core 10 (C# API) + Angular 21 (TypeScript PWA)  
**Repository Root:** Solution file is `EphemeralCryptexChat.slnx`

## Build, Test, and Run

### Frontend (Angular)

```bash
# Development server (http://localhost:4200)
cd client && npm start

# Run tests (Vitest)
npm test

# Build for production
npm run build

# Watch mode (compile on save)
npm run watch
```

### Backend (ASP.NET Core)

```bash
# Development server (http://localhost:5058 | https://localhost:7281)
cd api && dotnet run

# Build
dotnet build

# Run tests (if tests exist)
dotnet test
```

### Visual Studio 2026
Open `EphemeralCryptexChat.slnx`, set both projects to "Multiple Startup Projects" → Start, then F5.

## Architecture

### Full-Stack Data Flow

1. **Browser → API:** HTTP/SignalR calls authenticated with JWT (stored in IndexedDB)
2. **GitHub OAuth Flow:** 
   - Client redirects to `/auth/login` → GitHub OAuth → server creates/updates user + issues JWT
   - JWT is returned, stored client-side, rehydrated on app startup
3. **Real-time Chat:** SignalR `ChatHub` pushes new/edited messages to both sides in real-time
4. **E2E Encryption:**
   - Browser generates ECDH P-256 key pair at first login (stored in IndexedDB)
   - Public key sent to server; private key never leaves the device
   - Client derives shared secret with recipient's public key
   - All messages encrypted with AES-GCM before sending

### Backend Layers

- **Controllers** (`api/Controllers/`): REST + OAuth endpoints
- **Hubs** (`api/Hubs/ChatHub.cs`): SignalR real-time messaging
- **Services** (`api/Services/`): Business logic (interface-based, DI)
  - `IUserService` — user lookup, key registration
  - `IConversationService` — conversation management
  - `IMessageService` — message CRUD
  - `ITokenService` — JWT issuance
  - `ITtlCleanupService` — background ephemeral cleanup
- **Models** (`api/Models/`): EF Core entities (`User`, `Conversation`, `Message`, `CryptoKeyRecord`)
- **Data** (`api/Data/AppDbContext.cs`): EF Core DbContext + Migrations
- **DTOs** (`api/DTOs/`): Request/response contracts (map via `DtoMapper.cs`)

### Frontend Layers

- **State** (`src/app/core/state/app.state.ts`): Angular Signals for reactive state
  - `conversations`, `activeConversationId`, `currentUser`, `connectionState`
  - Computed signals: `activeConversation`, `isMyTurn`, `pendingMessage`
  - Helper functions: `upsertConversation()`, `patchConversation()`, `setConversations()`
- **Services** (`src/app/core/services/`):
  - `AuthService` — JWT rehydration, login/logout
  - `CryptoService` — ECDH key generation, AES-GCM encrypt/decrypt
  - `SignalRService` — ChatHub connection, event handlers
  - `ChatApiService` — HTTP REST calls (auth, users, conversations)
  - `NotificationService` — browser push notifications
  - `AudioService` — Web Audio effects
- **Guards** (`src/app/core/guards/`): Route protection (`AuthGuard`)
- **Interceptors** (`src/app/core/interceptors/`): Request/response middleware (JWT injection)
- **Models** (`src/app/core/models/`): TypeScript interfaces matching DTOs
- **Features** (`src/app/features/`): Page components (Auth, Channels, Chat, Playground, Manual)
- **Shared** (`src/app/shared/`): Reusable components (ScrambleText, AmbientBackground, Typewriter)

### Database

- **ORM:** EF Core + SQLite
- **Entities:** User, CryptoKeyRecord, Conversation, Message
- **Cleanup:** `TtlCleanupService` runs in background to delete expired messages

## Key Conventions

### C# / Backend

- **Service Pattern:** All business logic behind interfaces in `Services/Interfaces/`; DI in `Program.cs`
- **DTOs:** Separate request/response types in `DTOs/` folder, mapped via `DtoMapper.cs`
- **User Identity:** Claims from JWT; `User.Id` (int) and `User.GitHubId` (string) both used
- **Nullable:** Project has `<Nullable>enable</Nullable>`; use `?` for optional properties

### TypeScript / Frontend

- **Signals:** Central state in `app.state.ts`; use `signal()` for reactive values, `computed()` for derived state
- **Service Injection:** Use `inject()` in service constructors; services are `@Injectable({ providedIn: 'root' })`
- **Models:** Match backend DTOs 1:1 in `core/models/`
- **Styles:** SCSS in `src/styles.scss` (global) + component-scoped files; Prettier for formatting

### Folder Structure

- **Backend:** `api/{Controllers,Hubs,Services/Interfaces,Models,Data,DTOs}`
- **Frontend:** `client/src/app/{core/{services,guards,interceptors,models,state},features,shared}`
- **Config:** `api/appsettings.json` (connection string), `api/Properties/launchSettings.json` (ports)
- **GitHub:** `.github/workflows/deploy-client.yml` triggers on `client/**` → GitHub Pages

## Deployment

- **Backend:** Render.com (API)
- **Frontend:** GitHub Pages (deployed via GitHub Actions on main → client/**) with `baseHref: /EphemeralCryptexChat/`
- **Secrets:** Stored via `dotnet user-secrets` locally; GitHub repo secrets for CI/CD

## Important Notes

- **SignalR:** Runs on same port as API; client connects to WebSocket at runtime
- **JWT Expiration:** Check token before use; expired tokens trigger `logout()`
- **Key Binding:** Crypto keys are browser + device specific; new key pair generated on new browser/device
- **Turn-Based:** Only one user can send per conversation at a time (`currentTurnUserId`)
- **No Server Plaintext:** Server only stores ciphertext; decryption happens exclusively in browser
