// The public landing page follows the language switch like every other page: i18n.js translates it, and the switch sits in the header
import { langSwitch } from './i18n.js';
document.getElementById('lang').innerHTML = langSwitch();
