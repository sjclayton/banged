// Configurations that ship inside the extension. The first time Options is
// opened they are added to "Saved configurations", where they behave like any
// other saved entry (apply, merge, rename, delete). The bangs and settings live
// in `file`.
const BUILTIN_CONFIGS = [
  {
    id: "helium-browser-bangs",
    name: "Helium Browser Bangs",
    file: "presets/helium-browser-bangs.json",
    count: 10251
  }
];
