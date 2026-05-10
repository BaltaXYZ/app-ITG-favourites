import fs from "node:fs";
import path from "node:path";
import xlsx from "xlsx";

const { readFile, utils } = xlsx;

const workbookPath = path.join(process.cwd(), "assets", "ITG favourites.xlsx");
const outputJsonPath = path.join(process.cwd(), "src", "data", "songs.json");
const outputMarkdownPath = path.join(process.cwd(), "songs.md");

const sourceSheets = ["9", "10", "11", "12-13"];
const expectedCounts = {
  "9": 118,
  "10": 84,
  "11": 22,
  "12-13": 22
};

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
}

function readSongs() {
  const workbook = readFile(workbookPath, { cellDates: false });
  const songs = [];
  const counts = {};

  for (const difficulty of sourceSheets) {
    const sheet = workbook.Sheets[difficulty];
    if (!sheet) {
      throw new Error(`Missing sheet: ${difficulty}`);
    }

    const rows = utils.sheet_to_json(sheet, {
      header: 1,
      blankrows: false,
      raw: false
    });

    const sheetSongs = rows
      .map((row, index) => ({
        rowNumber: index + 1,
        title: row[0] ? String(row[0]).trim() : "",
        artist: row[1] ? String(row[1]).trim() : ""
      }))
      .filter((song) => song.title.length > 0)
      .map((song, index) => {
        const ordinal = String(index + 1).padStart(3, "0");
        const id = `${difficulty.replace("-", "_")}-${ordinal}-${slugify(song.title)}`;
        return {
          id,
          title: song.title,
          ...(song.artist ? { artist: song.artist } : {}),
          difficulty
        };
      });

    counts[difficulty] = sheetSongs.length;
    songs.push(...sheetSongs);
  }

  for (const difficulty of sourceSheets) {
    if (counts[difficulty] !== expectedCounts[difficulty]) {
      throw new Error(
        `Unexpected song count for ${difficulty}: ${counts[difficulty]} instead of ${expectedCounts[difficulty]}`
      );
    }
  }

  return { songs, counts };
}

function writeJson({ songs, counts }) {
  fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
  const payload = {
    source: "assets/ITG favourites.xlsx",
    generatedFromSheets: sourceSheets,
    ignoredSheets: ["Diagram1", "Danslista", "Karaoke", "Englas schema", "Blad1"],
    counts,
    songs
  };
  fs.writeFileSync(outputJsonPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeMarkdown({ songs, counts }) {
  const lines = [
    "# ITG favourites - låtdata",
    "",
    "Låtarna är extraherade från `assets/ITG favourites.xlsx`.",
    "",
    "Endast flikarna `9`, `10`, `11` och `12-13` används. Flikarna `Diagram1`, `Danslista`, `Karaoke`, `Englas schema` och `Blad1` ingår inte i appens låtdata.",
    ""
  ];

  for (const difficulty of sourceSheets) {
    lines.push(`## Svårighetsgrad ${difficulty}`);
    lines.push("");
    lines.push(`Antal låtar: ${counts[difficulty]}`);
    lines.push("");

    const songsForDifficulty = songs.filter((song) => song.difficulty === difficulty);
    songsForDifficulty.forEach((song, index) => {
      const suffix = song.artist ? ` - ${song.artist}` : "";
      lines.push(`${index + 1}. ${song.title}${suffix}`);
    });

    lines.push("");
  }

  fs.writeFileSync(outputMarkdownPath, `${lines.join("\n").trim()}\n`);
}

const result = readSongs();
writeJson(result);
writeMarkdown(result);
console.log(
  `Extracted ${result.songs.length} songs: ${sourceSheets
    .map((difficulty) => `${difficulty}=${result.counts[difficulty]}`)
    .join(", ")}`
);
