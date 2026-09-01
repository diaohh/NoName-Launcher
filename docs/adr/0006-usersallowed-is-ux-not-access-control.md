# 0006. `usersAllowed` is UX, not access control

- **Status**: Stand-by — blocked, not implementable as things stand
- **Date**: 2026-08-28
- **Commit**: n/a (documented in `TODO.md` P1)

## Context

Private modpacks are hidden with a `usersAllowed` array of Minecraft **usernames** on the
Firestore document, filtered in `firestoreService` on the renderer side.

It cannot be enforced in Security Rules today. `firebase.js` only does `initializeApp` +
`getFirestore`: **the launcher never authenticates against Firebase**, so `request.auth` is
always `null` in the rules and there is no identity to match a username against. Anyone with
the bundle can read the whole catalogue.

## Decision

Treat `usersAllowed` as **presentation only**, and say so wherever it appears. Do not
describe it as access control in the README, in the UI, or to pack authors. Nothing secret
goes in a modpack document while this stands.

The two ways out, neither taken yet:

- **Path A — Cloud Function + custom token.** A Function validates the Minecraft access token
  against `api.minecraftservices.com/minecraft/profile` and mints a Firebase custom token
  carrying the username as a claim; the renderer calls `signInWithCustomToken` and the rule
  becomes `allow read: if resource.data.usersAllowed.size() == 0 || request.auth.token.mcUsername in resource.data.usersAllowed`.
  This is the real fix. It requires the **Blaze plan** (Spark forbids outbound network calls
  to non-Google services) and new infrastructure to maintain.
- **Path B — redesign the data.** Rules allow reading only documents with `isPublic == true`;
  private packs stop being "public but hidden" and become unreadable without an identity.
  Closes the leak with no backend, but changes what `usersAllowed` means.

## Consequences

- The modpack catalogue is public data. Names, descriptions, banners and manifest URLs of
  unreleased packs are readable by anyone who runs the bundle.
- The manifest URL being readable is not by itself a second hole: the files are on a public
  CDN by design ([0001](0001-manifest-on-cdn-with-firestore-pointer.md)). The leak is the
  catalogue, not the payload.
- Whichever path is taken later is a schema or infrastructure change, not a patch — which is
  why this is recorded as a decision to *defer*, with the cost stated, rather than as a bug.

## Alternatives considered

- **Obfuscate the pack ids.** *(reconstructed)* Security by obscurity over a bundle the player already has on
  disk.
- **Ship a Firestore API key with restricted rules per user.** *(reconstructed)* There is no per-user identity
  to restrict by; that is the whole problem.
