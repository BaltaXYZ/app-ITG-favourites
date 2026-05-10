# GitHub-publicering: handoff

Det här dokumentet innehåller den information en ny Codex-tråd behöver för att lägga upp projektet på GitHub.

## Projekt

- Lokal projektmapp: `/Users/baltax/Documents/apps/app-ITG-favourites`
- Git-branch: `main`
- Föreslaget GitHub-repo: `app-ITG-favourites`
- Föreslagen synlighet: publikt repo
- Senast kontrollerad lokal Git-status: ren arbetskopia
- Senaste lokala commit vid denna handoff: `92bdd39 Add pass management flow`
- Git-användare i lokal config:
  - `user.name`: `BaltaXYZ`
  - `user.email`: `baltafamiljen3@gmail.com`

## Nuvarande GitHub-läge

Det finns ingen GitHub-remote i repo:t just nu. `git remote -v` ger ingen output.

`gh` CLI finns inte installerat i miljön just nu. Publicering behöver därför antingen göras via GitHubs webbgränssnitt eller efter att `gh` installerats/loggats in.

## Inloggning

1. Öppna `https://github.com/login`.
2. Logga in på rätt GitHub-konto.
3. Om Google-inloggning inte visar konto-ruta i Codex webbläsare, använd vanlig GitHub-inloggning med användarnamn/e-post och lösenord, eller logga in i en extern webbläsare och fortsätt därifrån.
4. Om tvåfaktorsautentisering krävs måste användaren själv slutföra den.

Spara inte lösenord, tokens eller 2FA-koder i projektfiler.

## Skapa repo via GitHub-webben

1. Gå till `https://github.com/new`.
2. Repository name: `app-ITG-favourites`
3. Visibility: `Public`
4. Skapa repo:t tomt:
   - ingen README
   - ingen `.gitignore`
   - ingen license
5. När repo:t är skapat, kopiera repo-URL:en.

## Koppla lokal repo och pusha

Kör från projektmappen:

```bash
cd /Users/baltax/Documents/apps/app-ITG-favourites
git remote add origin git@github.com:<GITHUB_USER_OR_ORG>/app-ITG-favourites.git
git push -u origin main
```

Om SSH inte är konfigurerat, använd HTTPS:

```bash
cd /Users/baltax/Documents/apps/app-ITG-favourites
git remote add origin https://github.com/<GITHUB_USER_OR_ORG>/app-ITG-favourites.git
git push -u origin main
```

Om `origin` redan råkar finnas:

```bash
git remote set-url origin <REPO_URL>
git push -u origin main
```

## Alternativ med GitHub CLI

Om `gh` installeras och är inloggat:

```bash
cd /Users/baltax/Documents/apps/app-ITG-favourites
gh auth login
gh repo create app-ITG-favourites --public --source=. --remote=origin --push
```

## Verifiera efter push

```bash
git remote -v
git status --short
git branch -vv
```

Förväntat:

- `origin` pekar på GitHub-repo:t.
- `main` trackar `origin/main`.
- `git status --short` är tom.

## Vercel-koppling

Projektet är redan deployat på Vercel:

- Produktion: `https://app-itg-favourites.vercel.app`
- Vercel project name: `app-itg-favourites`

Lokala Vercel-filer finns i `.vercel/`, men den mappen är ignorerad av Git och ska inte pushas.

## Viktigt

- Lägg inte in hemligheter i repo:t.
- `.vercel/`, `.next/`, `node_modules/`, `.env*.local` och liknande är redan ignorerade i `.gitignore`.
- Kör gärna innan push:

```bash
npm run lint
npm run test
npm run build
```
