// ملخص الأداء والمواد الإعلانية بالتفصيل (تابات الأداء): القائمة والعنوان بس. المحتوى قطع React في src/modules/overview تشتغل لحالها.
import { shell } from '/assets/common.js';

export default async function mount() {
  const creative = location.pathname.startsWith('/overview/creative');
  await shell({ active: creative ? 'overview:creative' : 'overview', title: creative ? 'المواد الإعلانية' : 'ملخص الأداء' });
}
