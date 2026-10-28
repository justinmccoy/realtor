/**
 * Berlin administrative geography, taken verbatim from the artifact.
 * District numbers are Berlin's official Bezirk numbers (01-12) and drive
 * the street-sign plate colors in the customer UI.
 */
export const DISTRICTS = [
  { num: "01", name: "Mitte" },
  { num: "02", name: "Friedrichshain-Kreuzberg" },
  { num: "03", name: "Pankow" },
  { num: "04", name: "Charlottenburg-Wilmersdorf" },
  { num: "05", name: "Spandau" },
  { num: "06", name: "Steglitz-Zehlendorf" },
  { num: "07", name: "Tempelhof-Schöneberg" },
  { num: "08", name: "Neukölln" },
  { num: "09", name: "Treptow-Köpenick" },
  { num: "10", name: "Marzahn-Hellersdorf" },
  { num: "11", name: "Lichtenberg" },
  { num: "12", name: "Reinickendorf" }
] as const;

export type DistrictName = (typeof DISTRICTS)[number]["name"];

export const DISTRICT_NAMES = DISTRICTS.map((d) => d.name) as [
  DistrictName,
  ...DistrictName[]
];

export const ORTSTEILE: Record<DistrictName, readonly string[]> = {
  Mitte: ["Mitte", "Moabit", "Hansaviertel", "Tiergarten", "Wedding", "Gesundbrunnen"],
  "Friedrichshain-Kreuzberg": ["Friedrichshain", "Kreuzberg"],
  Pankow: [
    "Prenzlauer Berg", "Pankow", "Weißensee", "Niederschönhausen", "Heinersdorf",
    "Französisch Buchholz", "Rosenthal", "Wilhelmsruh", "Blankenburg", "Blankenfelde",
    "Buch", "Karow", "Stadtrandsiedlung Malchow"
  ],
  "Charlottenburg-Wilmersdorf": [
    "Charlottenburg", "Wilmersdorf", "Westend", "Halensee", "Schmargendorf",
    "Grunewald", "Charlottenburg-Nord"
  ],
  Spandau: [
    "Spandau", "Wilhelmstadt", "Siemensstadt", "Haselhorst", "Hakenfelde",
    "Falkenhagener Feld", "Staaken", "Gatow", "Kladow"
  ],
  "Steglitz-Zehlendorf": [
    "Steglitz", "Lichterfelde", "Lankwitz", "Dahlem", "Zehlendorf", "Nikolassee", "Wannsee"
  ],
  "Tempelhof-Schöneberg": [
    "Schöneberg", "Friedenau", "Tempelhof", "Mariendorf", "Marienfelde", "Lichtenrade"
  ],
  Neukölln: ["Neukölln", "Britz", "Buckow", "Rudow", "Gropiusstadt"],
  "Treptow-Köpenick": [
    "Alt-Treptow", "Plänterwald", "Baumschulenweg", "Niederschöneweide",
    "Oberschöneweide", "Johannisthal", "Adlershof", "Altglienicke", "Bohnsdorf",
    "Köpenick", "Friedrichshagen", "Rahnsdorf", "Grünau", "Müggelheim", "Schmöckwitz"
  ],
  "Marzahn-Hellersdorf": ["Marzahn", "Hellersdorf", "Biesdorf", "Kaulsdorf", "Mahlsdorf"],
  Lichtenberg: [
    "Lichtenberg", "Friedrichsfelde", "Rummelsburg", "Karlshorst", "Fennpfuhl",
    "Alt-Hohenschönhausen", "Neu-Hohenschönhausen", "Falkenberg", "Malchow", "Wartenberg"
  ],
  Reinickendorf: [
    "Reinickendorf", "Tegel", "Wittenau", "Märkisches Viertel", "Borsigwalde",
    "Waidmannslust", "Hermsdorf", "Frohnau", "Heiligensee", "Konradshöhe", "Lübars"
  ]
};

export function districtNumber(name: string): string {
  return DISTRICTS.find((d) => d.name === name)?.num ?? "—";
}

export function isDistrict(name: string): name is DistrictName {
  return DISTRICTS.some((d) => d.name === name);
}
