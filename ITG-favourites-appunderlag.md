# ITG favourites - appunderlag

Källfilen ligger i projektet som `assets/ITG favourites.xlsx`.

## Syfte

Excel-dokumentet används för att slumpa fram en låtlista till dansmatta/ITG. Appen som ersätter dokumentet bör därför ha två huvuddelar:

- ett låtbibliotek där låtarna är grupperade efter svårighetsgrad
- en slumpgenerator som skapar en danslista från valda svårighetsnivåer

## Flikar som ska användas

### `9`

Innehåller låtar med svårighetsgrad 9. Det finns 118 låttitlar i kolumn A. Kolumn B innehåller artist för vissa låtar, men de flesta artistceller är tomma. Övriga kolumner verkar inte vara appdata.

### `10`

Innehåller låtar med svårighetsgrad 10. Det finns 84 låttitlar i kolumn A. Kolumn B innehåller artist för enstaka låtar.

### `11`

Innehåller låtar med svårighetsgrad 11. Det finns 22 låttitlar i kolumn A.

### `12-13`

Innehåller låtar med svårighetsgrad 12-13. Det finns 22 låttitlar i kolumn A.

### `Danslista`

Det här är den nuvarande slumpade spellistan. Fliken har rubriker för svårighetsnivåerna 9, 10, 11 och 12-13 och använder Excel-formler med `INDEX` och `RANDBETWEEN` för att dra låtar från respektive låtflik. I Excel står det att man trycker `fn+F9` för att få en ny danslista.

Nuvarande standardupplägg i fliken är:

- 22 slumpade låtar från svårighetsgrad 9
- 21 slumpade låtar från svårighetsgrad 10
- 10 slumpade låtar från svårighetsgrad 11
- 5 slumpade låtar från svårighetsgrad 12-13

Excel-formlerna väljer varje rad oberoende av de andra, så samma låt kan i princip slumpas fram flera gånger. Om appen ska följa Excel-beteendet exakt ska den alltså slumpa med återläggning. Om appen ska förbättra upplevelsen kan den i stället ha ett val för att undvika dubletter.

## Flikar som inte ska tas med i appen

### `Diagram1`

Detta är en diagramflik/chartsheet. Den ingår inte i appens kärnfunktion och ska inte byggas om som appvy.

### `Karaoke`

Den här fliken innehåller karaoke-/staminaresultat och andra lösa slumpformler. Den ska inte användas för dansmatteappen.

### `Englas schema`

Den här fliken, motsvarande det som avses med Änglasschema, innehåller schema-/aktivitetsplanering och viktade slumpformler. Den ska inte användas för dansmatteappen.

### `Blad1`

Den här fliken innehåller en separat slumpövning med anatomiska/artärrelaterade ord. Den hör inte till dansmattelåtarna och ska inte användas i appen.

## Förslag till appmodell

En framtida app kan modellera varje låt ungefär så här:

```ts
type Song = {
  id: string;
  title: string;
  artist?: string;
  difficulty: "9" | "10" | "11" | "12-13";
};
```

Slumpgeneratorn bör ha standardvärden som matchar `Danslista`, men gärna låta användaren ändra hur många låtar som ska dras från varje svårighetsgrad. Appen behöver inte återskapa Excel-flikarna visuellt; den viktiga funktionen är att lagra låtarna per nivå och skapa en ny slumpad danslista med en tydlig knapp, till exempel "Slumpa ny lista".
