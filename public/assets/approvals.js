// الاعتمادات: القائمة والعنوان بس. المحتوى قطعة React في src/components/approvals تشتغل لحالها.
import { shell } from '/assets/common.js';

export default async function mount() {
  await shell({ active: 'approvals', title: 'الاعتمادات' });
}
