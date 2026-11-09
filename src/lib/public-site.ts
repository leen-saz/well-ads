// The public marketing pages (/welcome/, /profile/, /security/): shared links and contact in one place.
// Change the contact here and every page and button follows.
export const CONTACT = {
  // WhatsApp number in international form, digits only (from the A Pipeline site footer). Empty hides the WhatsApp buttons.
  whatsapp: '966505130111',
  phoneLabel: '٠٥٠٥١٣٠١١١',
};

export const wa = (text: string) => CONTACT.whatsapp ? `https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(text)}` : '#contact';

export const NAV = [
  { href: '/welcome/', label: 'اللوحة' },
  { href: '/security/', label: 'الأمن السيبراني' },
  { href: '/profile/', label: 'من نحن' },
];
