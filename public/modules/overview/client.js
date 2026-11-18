// ملخص الأداء والمواد الإعلانية بالتفصيل (تابات الأداء): القائمة والعنوان بس. المحتوى قطع React في src/modules/overview تشتغل لحالها.
import { shell, $, esc } from '/assets/common.js';

export default async function mount() {
  const me = await shell({ active: 'overview', title: 'ملخص الأداء' });
  // The summary's numbers need the analytics access (ceo) too. Without it the strip does not offer this page; opened by its address, it says so in
  // plain words instead of the server's refusal. (The permission rules are the server's and are unchanged.)
  if (me.role !== 'owner' && !(me.dashboards || []).includes('ceo')) {
    const c = $('#content');
    c.classList.add('no-ceo');
    c.insertAdjacentHTML('afterbegin', `<p class="card pad no-ceo-msg" role="status">${esc('ملخص الأداء يحتاج صلاحية أرقام التحليلات. اطلب من المالك يفتحها لك.')}</p>`);
  }
}
