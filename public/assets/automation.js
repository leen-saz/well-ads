// الأتمتة: القائمة والعنوان بس. المحتوى قطعة React في src/components/automation تشتغل لحالها.
import { shell } from '/assets/common.js';

export default async function mount() {
  await shell({ active: 'control', title: 'الأتمتة' });
}
