// نظرة عامة: القائمة والعنوان بس. الأرقام والرسم والجدول قطعة React (src/modules/overview/Overview.tsx) تشتغل لحالها.
import { shell } from '/assets/common.js';

export default async function mount() {
  await shell({ active: 'overview', title: 'نظرة عامة' });
}
