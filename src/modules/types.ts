// One tab = one module. A module owns its folder (src/modules/<key>/) and its script (public/modules/<key>/client.js).
// status: live = built; soon = shows "قريباً" with what it will do. group = which of the six sidebar groups it sits under
// (public/assets/sidebar.js GROUPS).
export interface ModuleMeta {
  key: string;
  ar: string;
  en: string;
  icon: string;          // Lucide SVG paths (stroke 1.75)
  group: 'home' | 'produce' | 'distribute' | 'measure' | 'optimize' | 'system';
  status: 'live' | 'soon';
  does: string[];
  doesEn: string[];
  // Shown as a section inside another tab (its key) instead of its own sidebar entry: /<into>/?tab=<key>. Access, lock and API stay this module's own
  into?: string;
  // More pages of the same module, under it in the sidebar: /<key>/<path>/ (same access as the module)
  pages?: { path: string; ar: string; en: string; icon: string }[];
}
