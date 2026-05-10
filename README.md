# ITG Favourites

Webbapp för att bygga och köra timerstyrda danspass för dansmatta/ITG.

Appen använder låtarna från `assets/ITG favourites.xlsx`. Endast flikarna `9`,
`10`, `11` och `12-13` används som låtdata. Övriga flikar i arbetsboken är
referensmaterial eller separata anteckningar och ingår inte i appen.

## Kommandon

```bash
npm run extract:songs
npm run dev
npm run lint
npm run test
npm run build
```

## Appflöde

1. Välj färdig mall eller bygg ett eget upplägg.
2. Ange mål­tiden för passet och antal uppvärmningslåtar.
3. Starta passet.
4. Appen visar en låt i taget.
5. Klicka `Klar - nästa låt` efter varje låt.
6. Passet avslutas först när mål­tiden har passerats och du klickar `Klar`.
