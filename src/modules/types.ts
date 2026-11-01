// One tab = one module. A module owns its folder (src/modules/<key>/) and its script (public/modules/<key>/client.js).
// status: live = built; soon = shows "قريباً" with what it will do. group places it in the sidebar.
export interface ModuleMeta {
  key: string;
  ar: string;
  en: string;
  icon: string;          // Lucide SVG paths (stroke 1.75)
  group: 'agents' | 'growth';
  status: 'live' | 'soon';
  does: string[];
  doesEn: string[];
}
