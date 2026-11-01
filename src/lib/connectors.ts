// Ported from well-ads-dashboard web/lib/connectors.js (#43); data unchanged, types added.
// قائمة المنصات في صفحة الربط. كل منصة: طريقة الربط، والخانات حسب توثيقها الرسمي، ورابط استخراج المفاتيح.
// env = اسم المتغير اللي يقراه السحب. القيمة تنحفظ في Supabase Vault بهالاسم، وما ترجع للمتصفح أبداً.
// secret: false = رقم حساب أو معرّف، ينعرض في الصفحة. fetch: true = عندنا سحب بيانات لها اليوم.
// إضافة منصة جديدة = عنصر جديد هنا بس.

export interface Field { env: string; label: string; secret: boolean; type: string; optional?: boolean; manual?: boolean; placeholder?: string }
export interface Platform { id: string; name: string; group: string; fetch?: boolean; mcp?: boolean; docs?: string; help?: string; fields: Field[]; logo?: string | null; color?: string | null }
type FieldOpts = Partial<Omit<Field, 'env' | 'label'>>;
const F = (env: string, label: string, opts: FieldOpts = {}): Field => ({ env, label, secret: true, type: 'password', ...opts });
const ID = (env: string, label: string, opts: FieldOpts = {}): Field => F(env, label, { secret: false, type: 'text', ...opts });

export const PLATFORMS: Platform[] = [
  // ---- الإعلانات
  { id: 'meta', name: 'Meta (فيسبوك وانستقرام)', group: 'ads', fetch: true,
    docs: 'https://business.facebook.com/settings/system-users',
    help: 'إعدادات الأعمال ← مستخدمو النظام ← إنشاء رمز (ads_read, ads_management, business_management). هذا المفتاح ما ينتهي.',
    fields: [F('META_ACCESS_TOKEN', 'مفتاح مستخدم النظام', { manual: true }), ID('META_AD_ACCOUNT_ID', 'رقم الحساب الإعلاني', { placeholder: 'act_1234567890' })] },
  { id: 'snap', name: 'Snapchat', group: 'ads', fetch: true,
    docs: 'https://business.snapchat.com/', help: 'Business Manager ← Business Details ← OAuth App. بعد الربط اكتب رقم المنظمة والحساب الإعلاني.',
    fields: [ID('SNAP_ORGANIZATION_ID', 'رقم المنظمة (Organization ID)'), ID('SNAP_AD_ACCOUNT_ID', 'رقم الحساب الإعلاني'),
      F('SNAP_CLIENT_ID', 'Client ID', { manual: true }), F('SNAP_CLIENT_SECRET', 'Client Secret', { manual: true }), F('SNAP_REFRESH_TOKEN', 'Refresh Token', { manual: true })] },
  { id: 'google_ads', name: 'Google Ads و YouTube', group: 'ads', fetch: true,
    docs: 'https://developers.google.com/google-ads/api/docs/get-started/introduction', help: 'Google Cloud ← OAuth client، و Google Ads ← API Center ← Developer token.',
    fields: [ID('GOOGLE_ADS_CUSTOMER_ID', 'رقم الحساب (Customer ID)', { placeholder: '123-456-7890' }), ID('GOOGLE_ADS_LOGIN_CUSTOMER_ID', 'رقم حساب المدير (MCC)', { optional: true }),
      F('GOOGLE_ADS_DEVELOPER_TOKEN', 'Developer Token', { optional: true }),
      F('GOOGLE_ADS_CLIENT_ID', 'OAuth Client ID', { manual: true }), F('GOOGLE_ADS_CLIENT_SECRET', 'OAuth Client Secret', { manual: true }), F('GOOGLE_ADS_REFRESH_TOKEN', 'Refresh Token', { manual: true })] },
  { id: 'tiktok', name: 'TikTok', group: 'ads', fetch: true, mcp: true, docs: 'https://ads.tiktok.com/', help: 'مربوط عن طريق موصّل TikTok for Business في Claude (MCP).', fields: [] },
  { id: 'x', name: 'X (تويتر)', group: 'ads', docs: 'https://developer.x.com/en/portal/dashboard', help: 'X Developer Portal ← تطبيق بصلاحية Ads API (مدفوع) ← Keys and tokens.',
    fields: [F('X_ADS_CONSUMER_KEY', 'API Key', { manual: true }), F('X_ADS_CONSUMER_SECRET', 'API Key Secret', { manual: true }), F('X_ADS_ACCESS_TOKEN', 'Access Token', { manual: true }), F('X_ADS_ACCESS_SECRET', 'Access Token Secret', { manual: true }), ID('X_ADS_ACCOUNT_ID', 'رقم الحساب الإعلاني')] },
  { id: 'linkedin', name: 'LinkedIn', group: 'ads', docs: 'https://www.linkedin.com/developers/apps', help: 'LinkedIn Developers ← تطبيق بمنتج Advertising API (يحتاج موافقة) ← Auth.',
    fields: [F('LINKEDIN_CLIENT_ID', 'Client ID', { manual: true }), F('LINKEDIN_CLIENT_SECRET', 'Client Secret', { manual: true }), F('LINKEDIN_REFRESH_TOKEN', 'Refresh Token', { manual: true }), ID('LINKEDIN_AD_ACCOUNT_ID', 'رقم الحساب الإعلاني')] },
  { id: 'pinterest', name: 'Pinterest', group: 'ads', docs: 'https://developers.pinterest.com/apps/', help: 'Pinterest Developers ← My apps ← App ID و secret، وبعدها refresh token.',
    fields: [F('PINTEREST_APP_ID', 'App ID', { manual: true }), F('PINTEREST_APP_SECRET', 'App Secret', { manual: true }), F('PINTEREST_REFRESH_TOKEN', 'Refresh Token', { manual: true }), ID('PINTEREST_AD_ACCOUNT_ID', 'رقم الحساب الإعلاني')] },
  { id: 'reddit', name: 'Reddit', group: 'ads', docs: 'https://ads.reddit.com/', help: 'Reddit Ads ← Developer Applications ← تطبيق جديد.',
    fields: [F('REDDIT_CLIENT_ID', 'App ID', { manual: true }), F('REDDIT_CLIENT_SECRET', 'Secret', { manual: true }), F('REDDIT_REFRESH_TOKEN', 'Refresh Token', { manual: true }), ID('REDDIT_AD_ACCOUNT_ID', 'رقم الحساب الإعلاني')] },
  { id: 'microsoft', name: 'Microsoft Ads (Bing)', group: 'ads', docs: 'https://developers.ads.microsoft.com/Account', help: 'Microsoft Advertising Developer Portal ← Developer token، و Azure ← App registration.',
    fields: [F('MSADS_DEVELOPER_TOKEN', 'Developer Token'), F('MSADS_CLIENT_ID', 'Client ID', { manual: true }), F('MSADS_CLIENT_SECRET', 'Client Secret', { optional: true, manual: true }), F('MSADS_REFRESH_TOKEN', 'Refresh Token', { manual: true }),
      ID('MSADS_CUSTOMER_ID', 'Customer ID'), ID('MSADS_ACCOUNT_ID', 'Account ID')] },
  { id: 'amazon', name: 'Amazon Ads', group: 'ads', docs: 'https://advertising.amazon.com/API/docs/en-us/guides/onboarding/overview', help: 'Amazon Ads API (يحتاج موافقة) ← Login with Amazon ← Security profile.',
    fields: [F('AMAZON_ADS_CLIENT_ID', 'Client ID', { manual: true }), F('AMAZON_ADS_CLIENT_SECRET', 'Client Secret', { manual: true }), F('AMAZON_ADS_REFRESH_TOKEN', 'Refresh Token', { manual: true }), ID('AMAZON_ADS_PROFILE_ID', 'Profile ID')] },
  { id: 'apple', name: 'Apple Search Ads', group: 'ads', docs: 'https://searchads.apple.com/', help: 'Search Ads ← Settings ← API ← أنشئ مفتاح وارفع المفتاح العام.',
    fields: [F('APPLE_ADS_CLIENT_ID', 'Client ID'), F('APPLE_ADS_TEAM_ID', 'Team ID'), F('APPLE_ADS_KEY_ID', 'Key ID'), F('APPLE_ADS_PRIVATE_KEY', 'Private Key (PEM)', { type: 'textarea' }), ID('APPLE_ADS_ORG_ID', 'Org ID')] },
  { id: 'taboola', name: 'Taboola', group: 'ads', docs: 'https://developers.taboola.com/backstage-api/reference', help: 'اطلب بيانات API من مدير حسابك في Taboola.',
    fields: [F('TABOOLA_CLIENT_ID', 'Client ID'), F('TABOOLA_CLIENT_SECRET', 'Client Secret'), ID('TABOOLA_ACCOUNT_ID', 'Account ID')] },
  { id: 'outbrain', name: 'Outbrain', group: 'ads', docs: 'https://amplifyv01.docs.apiary.io/', help: 'Amplify API ← طلب صلاحية API من Outbrain ← Token.',
    fields: [F('OUTBRAIN_TOKEN', 'OB-TOKEN-V1'), ID('OUTBRAIN_MARKETER_ID', 'Marketer ID')] },
  { id: 'quora', name: 'Quora', group: 'ads', docs: 'https://www.quora.com/ads/', help: 'Quora Ads ← طلب صلاحية API ← Access token.',
    fields: [F('QUORA_ACCESS_TOKEN', 'Access Token'), ID('QUORA_ACCOUNT_ID', 'Account ID')] },
  { id: 'dv360', name: 'Google Display & Video 360', group: 'ads', docs: 'https://developers.google.com/display-video/api/guides/getting-started/overview', help: 'Google Cloud ← فعّل Display & Video 360 API ← Service account، وأضفه مستخدم في DV360.',
    fields: [F('DV360_SERVICE_ACCOUNT_JSON', 'Service account JSON', { type: 'textarea', manual: true }), ID('DV360_ADVERTISER_ID', 'Advertiser ID')] },
  { id: 'cm360', name: 'Campaign Manager 360', group: 'ads', docs: 'https://developers.google.com/doubleclick-advertisers/getting_started', help: 'Google Cloud ← فعّل Campaign Manager 360 API ← Service account، وأضفه مستخدم في CM360.',
    fields: [F('CM360_SERVICE_ACCOUNT_JSON', 'Service account JSON', { type: 'textarea', manual: true }), ID('CM360_PROFILE_ID', 'User profile ID')] },
  { id: 'sa360', name: 'Search Ads 360', group: 'ads', docs: 'https://developers.google.com/search-ads/reporting/overview', help: 'Google Cloud ← OAuth client ← فعّل Search Ads 360 Reporting API.',
    fields: [F('SA360_CLIENT_ID', 'Client ID', { manual: true }), F('SA360_CLIENT_SECRET', 'Client Secret', { manual: true }), F('SA360_REFRESH_TOKEN', 'Refresh Token', { manual: true }), ID('SA360_CUSTOMER_ID', 'Customer ID'), ID('SA360_LOGIN_CUSTOMER_ID', 'Manager ID', { optional: true })] },
  { id: 'ttd', name: 'The Trade Desk', group: 'ads', docs: 'https://partner.thetradedesk.com/v3/portal/api/doc/Authentication', help: 'اطلب صلاحية API من مدير حسابك ← API token طويل المدى.',
    fields: [F('TTD_API_TOKEN', 'API Token'), ID('TTD_PARTNER_ID', 'Partner ID'), ID('TTD_ADVERTISER_ID', 'Advertiser ID')] },
  { id: 'criteo', name: 'Criteo', group: 'ads', docs: 'https://developers.criteo.com/', help: 'Criteo Developers ← My apps ← تطبيق جديد ← Client credentials.',
    fields: [F('CRITEO_CLIENT_ID', 'Client ID'), F('CRITEO_CLIENT_SECRET', 'Client Secret'), ID('CRITEO_ADVERTISER_ID', 'Advertiser ID')] },
  { id: 'yahoo_dsp', name: 'Yahoo DSP', group: 'ads', docs: 'https://developer.yahooinc.com/dsp/api/docs/', help: 'Yahoo DSP ← طلب صلاحية API ← Client ID و Secret.',
    fields: [F('YAHOO_DSP_CLIENT_ID', 'Client ID'), F('YAHOO_DSP_CLIENT_SECRET', 'Client Secret'), ID('YAHOO_DSP_SEAT_ID', 'Seat ID')] },
  { id: 'spotify', name: 'Spotify Ads', group: 'ads', docs: 'https://developer.spotify.com/documentation/ads-api', help: 'Spotify for Developers ← تطبيق بصلاحية Ads API ← OAuth.',
    fields: [F('SPOTIFY_ADS_CLIENT_ID', 'Client ID'), F('SPOTIFY_ADS_CLIENT_SECRET', 'Client Secret'), F('SPOTIFY_ADS_REFRESH_TOKEN', 'Refresh Token'), ID('SPOTIFY_ADS_ACCOUNT_ID', 'Ad account ID')] },
  { id: 'adroll', name: 'AdRoll', group: 'ads', docs: 'https://developers.adroll.com/', help: 'AdRoll Developers ← تطبيق جديد ← OAuth.',
    fields: [F('ADROLL_CLIENT_ID', 'Client ID'), F('ADROLL_CLIENT_SECRET', 'Client Secret'), F('ADROLL_REFRESH_TOKEN', 'Refresh Token'), ID('ADROLL_ADVERTISABLE_ID', 'Advertisable EID')] },
  { id: 'stackadapt', name: 'StackAdapt', group: 'ads', docs: 'https://docs.stackadapt.com/', help: 'StackAdapt ← Settings ← API key.',
    fields: [F('STACKADAPT_API_KEY', 'API Key'), ID('STACKADAPT_ADVERTISER_ID', 'Advertiser ID')] },
  { id: 'teads', name: 'Teads', group: 'ads', docs: 'https://developers.teads.com/', help: 'Teads Ad Manager ← طلب صلاحية API ← Token.',
    fields: [F('TEADS_API_TOKEN', 'API Token'), ID('TEADS_ADVERTISER_ID', 'Advertiser ID')] },
  { id: 'yandex', name: 'Yandex Direct', group: 'ads', docs: 'https://yandex.com/dev/direct/', help: 'Yandex OAuth ← تطبيق جديد ← OAuth token.',
    fields: [F('YANDEX_DIRECT_TOKEN', 'OAuth Token', { manual: true }), ID('YANDEX_DIRECT_LOGIN', 'Client login')] },
  { id: 'unity', name: 'Unity Ads', group: 'ads', docs: 'https://docs.unity.com/acquire/en-us/manual/advertising-apis', help: 'Unity Dashboard ← Administration ← Service accounts ← Key.',
    fields: [F('UNITY_KEY_ID', 'Key ID'), F('UNITY_SECRET_KEY', 'Secret Key'), ID('UNITY_ORG_ID', 'Organization ID')] },
  { id: 'applovin', name: 'AppLovin', group: 'ads', docs: 'https://developers.applovin.com/', help: 'AppLovin ← Account ← Keys ← Report key.',
    fields: [F('APPLOVIN_REPORT_KEY', 'Report Key')] },
  { id: 'ironsource', name: 'ironSource (Unity LevelPlay)', group: 'ads', docs: 'https://developers.is.com/', help: 'ironSource ← My Account ← API ← Secret key و Refresh token.',
    fields: [F('IRONSOURCE_SECRET_KEY', 'Secret Key'), F('IRONSOURCE_REFRESH_TOKEN', 'Refresh Token')] },
  { id: 'moloco', name: 'Moloco', group: 'ads', docs: 'https://help.moloco.com/', help: 'Moloco Cloud ← طلب صلاحية API ← API key.',
    fields: [F('MOLOCO_API_KEY', 'API Key'), ID('MOLOCO_AD_ACCOUNT_ID', 'Ad account ID')] },
  { id: 'liftoff', name: 'Liftoff', group: 'ads', docs: 'https://docs.liftoff.io/', help: 'Liftoff ← طلب صلاحية Reporting API ← API key و secret.',
    fields: [F('LIFTOFF_API_KEY', 'API Key'), F('LIFTOFF_API_SECRET', 'API Secret')] },
  { id: 'mintegral', name: 'Mintegral', group: 'ads', docs: 'https://www.mintegral.com/', help: 'Mintegral ← Account ← API ← Access key و API key.',
    fields: [F('MINTEGRAL_ACCESS_KEY', 'Access Key'), F('MINTEGRAL_API_KEY', 'API Key')] },
  { id: 'meta_capi', name: 'Meta Conversions API (Pixel)', group: 'ads', docs: 'https://business.facebook.com/events_manager2', help: 'Events Manager ← البيكسل ← Settings ← Conversions API ← Generate access token.',
    fields: [F('META_CAPI_TOKEN', 'Conversions API token'), ID('META_PIXEL_ID', 'Pixel / Dataset ID')] },
  { id: 'tiktok_events', name: 'TikTok Events API (Pixel)', group: 'ads', docs: 'https://ads.tiktok.com/i18n/events_manager', help: 'Events Manager ← البيكسل ← Settings ← Generate access token.',
    fields: [F('TIKTOK_EVENTS_TOKEN', 'Events API token'), ID('TIKTOK_PIXEL_ID', 'Pixel ID')] },
  { id: 'snap_capi', name: 'Snap Conversions API (Pixel)', group: 'ads', docs: 'https://businesshelp.snapchat.com/s/article/capi-overview', help: 'Ads Manager ← Events Manager ← البيكسل ← Conversions API token.',
    fields: [F('SNAP_CAPI_TOKEN', 'Conversions API token'), ID('SNAP_PIXEL_ID', 'Pixel ID')] },

  // ---- التحليلات
  { id: 'ga4', name: 'Google Analytics 4', group: 'analytics', fetch: true, docs: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
    help: 'Google Cloud ← Service account ← Keys ← JSON، وأضف إيميله Viewer في GA4.',
    fields: [F('GA4_SERVICE_ACCOUNT_JSON', 'Service account JSON', { type: 'textarea', manual: true }), ID('GA4_PROPERTY_ID', 'Property ID', { placeholder: '123456789' })] },
  { id: 'search_console', name: 'Google Search Console', group: 'analytics', docs: 'https://search.google.com/search-console', help: 'نفس Service account، وأضف إيميله مستخدم في Search Console.',
    fields: [F('GSC_SERVICE_ACCOUNT_JSON', 'Service account JSON', { type: 'textarea', manual: true }), ID('GSC_SITE_URL', 'رابط الموقع', { placeholder: 'sc-domain:wellcare.sa' })] },
  { id: 'gtm', name: 'Google Tag Manager', group: 'analytics', docs: 'https://tagmanager.google.com/', help: 'نفس Service account، وأضف إيميله مستخدم في الحاوية.',
    fields: [F('GTM_SERVICE_ACCOUNT_JSON', 'Service account JSON', { type: 'textarea', manual: true }), ID('GTM_ACCOUNT_ID', 'Account ID'), ID('GTM_CONTAINER_ID', 'Container ID')] },
  { id: 'firebase', name: 'Firebase', group: 'analytics', docs: 'https://console.firebase.google.com/', help: 'Project settings ← Service accounts ← Generate new private key.',
    fields: [F('FIREBASE_SERVICE_ACCOUNT_JSON', 'Service account JSON', { type: 'textarea', manual: true }), ID('FIREBASE_PROJECT_ID', 'Project ID')] },
  { id: 'clarity', name: 'Microsoft Clarity', group: 'analytics', docs: 'https://clarity.microsoft.com/', help: 'المشروع ← Settings ← Data Export ← Generate new API token.',
    fields: [F('CLARITY_API_TOKEN', 'API Token'), ID('CLARITY_PROJECT_ID', 'Project ID')] },
  { id: 'hotjar', name: 'Hotjar', group: 'analytics', docs: 'https://insights.hotjar.com/', help: 'Organization settings ← API ← Create API key.',
    fields: [F('HOTJAR_CLIENT_ID', 'Client ID'), F('HOTJAR_CLIENT_SECRET', 'Client Secret'), ID('HOTJAR_SITE_ID', 'Site ID')] },
  { id: 'mixpanel', name: 'Mixpanel', group: 'analytics', docs: 'https://mixpanel.com/settings/org#serviceaccounts', help: 'Organization settings ← Service accounts.',
    fields: [F('MIXPANEL_SA_USERNAME', 'Service account username'), F('MIXPANEL_SA_SECRET', 'Service account secret'), ID('MIXPANEL_PROJECT_ID', 'Project ID')] },
  { id: 'amplitude', name: 'Amplitude', group: 'analytics', docs: 'https://app.amplitude.com/', help: 'Settings ← Projects ← المشروع ← General.',
    fields: [F('AMPLITUDE_API_KEY', 'API Key'), F('AMPLITUDE_SECRET_KEY', 'Secret Key')] },
  { id: 'appsflyer', name: 'AppsFlyer', group: 'analytics', docs: 'https://hq1.appsflyer.com/account/myprofile/apitokens', help: 'Security center ← API tokens ← V2.',
    fields: [F('APPSFLYER_API_TOKEN', 'API Token (V2)'), ID('APPSFLYER_APP_ID', 'App ID')] },
  { id: 'adjust', name: 'Adjust', group: 'analytics', docs: 'https://suite.adjust.com/account/my-profile', help: 'Account settings ← My profile ← API token.',
    fields: [F('ADJUST_API_TOKEN', 'API Token'), ID('ADJUST_APP_TOKEN', 'App Token')] },
  { id: 'branch', name: 'Branch', group: 'analytics', docs: 'https://dashboard.branch.io/account-settings/user', help: 'Account settings ← User ← API access token.',
    fields: [F('BRANCH_ACCESS_TOKEN', 'API Access Token'), F('BRANCH_KEY', 'Branch Key'), F('BRANCH_SECRET', 'Branch Secret')] },
  { id: 'singular', name: 'Singular', group: 'analytics', docs: 'https://app.singular.net/#/api', help: 'Developer tools ← API keys ← Reporting API key.',
    fields: [F('SINGULAR_API_KEY', 'Reporting API Key')] },
  { id: 'kochava', name: 'Kochava', group: 'analytics', docs: 'https://support.kochava.com/', help: 'Account options ← API keys.',
    fields: [F('KOCHAVA_API_KEY', 'API Key'), ID('KOCHAVA_APP_GUID', 'App GUID')] },
  { id: 'adobe', name: 'Adobe Analytics', group: 'analytics', docs: 'https://developer.adobe.com/console', help: 'Adobe Developer Console ← مشروع ← Analytics API ← OAuth Server-to-Server.',
    fields: [F('ADOBE_CLIENT_ID', 'Client ID'), F('ADOBE_CLIENT_SECRET', 'Client Secret'), ID('ADOBE_ORG_ID', 'IMS Org ID'), ID('ADOBE_COMPANY_ID', 'Global Company ID'), ID('ADOBE_RSID', 'Report Suite ID')] },
  { id: 'matomo', name: 'Matomo', group: 'analytics', docs: 'https://matomo.org/faq/general/faq_114/', help: 'Administration ← Personal ← Security ← Auth tokens.',
    fields: [ID('MATOMO_URL', 'رابط Matomo', { placeholder: 'https://analytics.example.com' }), F('MATOMO_TOKEN', 'Auth Token'), ID('MATOMO_SITE_ID', 'Site ID')] },
  { id: 'plausible', name: 'Plausible', group: 'analytics', docs: 'https://plausible.io/settings/api-keys', help: 'Settings ← API keys ← New API key.',
    fields: [F('PLAUSIBLE_API_KEY', 'API Key'), ID('PLAUSIBLE_SITE_ID', 'Site domain', { placeholder: 'wellcare.sa' })] },
  { id: 'posthog', name: 'PostHog', group: 'analytics', docs: 'https://us.posthog.com/settings/user-api-keys', help: 'Settings ← Personal API keys ← Create (read).',
    fields: [F('POSTHOG_API_KEY', 'Personal API Key'), ID('POSTHOG_PROJECT_ID', 'Project ID'), ID('POSTHOG_HOST', 'Host', { placeholder: 'https://us.posthog.com', optional: true })] },
  { id: 'heap', name: 'Heap', group: 'analytics', docs: 'https://developers.heap.io/', help: 'Account ← Manage ← Privacy & Security ← API key.',
    fields: [F('HEAP_API_KEY', 'API Key'), ID('HEAP_APP_ID', 'App ID')] },
  { id: 'segment', name: 'Segment', group: 'analytics', docs: 'https://app.segment.com/', help: 'Settings ← Access management ← Tokens ← Public API token.',
    fields: [F('SEGMENT_API_TOKEN', 'Public API Token'), ID('SEGMENT_WORKSPACE', 'Workspace slug')] },
  { id: 'looker', name: 'Looker Studio / BigQuery', group: 'analytics', docs: 'https://console.cloud.google.com/bigquery', help: 'Google Cloud ← Service account بصلاحية BigQuery Data Viewer ← JSON.',
    fields: [F('BIGQUERY_SERVICE_ACCOUNT_JSON', 'Service account JSON', { type: 'textarea', manual: true }), ID('BIGQUERY_PROJECT_ID', 'Project ID'), ID('BIGQUERY_DATASET', 'Dataset')] },
];

// الشعارات: ملفات Simple Icons (CC0) محفوظة في /assets/logos (الـ CSP ما يسمح بصور من برّا).
// المنصة اللي ما لها شعار في المكتبة: حرفها الأول بلونها.
const LOGO: Record<string, string> = {
  meta: 'meta', meta_capi: 'meta', snap: 'snapchat', snap_capi: 'snapchat', tiktok: 'tiktok', tiktok_events: 'tiktok', google_ads: 'googleads', x: 'x',
  pinterest: 'pinterest', reddit: 'reddit', apple: 'apple', quora: 'quora', dv360: 'googledisplayandvideo360', cm360: 'googlecampaignmanager360', sa360: 'googleads',
  spotify: 'spotify', adroll: 'adroll', unity: 'unity', ga4: 'googleanalytics', search_console: 'googlesearchconsole', gtm: 'googletagmanager', firebase: 'firebase',
  hotjar: 'hotjar', mixpanel: 'mixpanel', matomo: 'matomo', plausible: 'plausibleanalytics', posthog: 'posthog', looker: 'googlebigquery',
};
const COLOR: Record<string, string> = {
  meta: '#0467DF', meta_capi: '#0467DF', snap: '#E6C800', snap_capi: '#E6C800', tiktok: '#000000', tiktok_events: '#000000', google_ads: '#4285F4', x: '#000000',
  linkedin: '#0A66C2', pinterest: '#BD081C', reddit: '#FF4500', microsoft: '#00A4EF', amazon: '#FF9900', apple: '#000000', taboola: '#1C5BD9', outbrain: '#F26722',
  quora: '#B92B27', dv360: '#34A853', cm360: '#1E8E3E', sa360: '#4285F4', ttd: '#0099FA', criteo: '#FE5000', yahoo_dsp: '#6001D2', spotify: '#1DB954',
  adroll: '#0DBDFF', stackadapt: '#3F3CFF', teads: '#111111', yandex: '#FC3F1D', unity: '#000000', applovin: '#0B7EEF', ironsource: '#1E57FF', moloco: '#1F2A44',
  liftoff: '#1D1D1D', mintegral: '#00A8FF', ga4: '#E37400', search_console: '#458CF5', gtm: '#246FDB', firebase: '#DD2C00', clarity: '#0078D4', hotjar: '#FF3C00',
  mixpanel: '#7856FF', amplitude: '#1E61F0', appsflyer: '#12A4E0', adjust: '#00BED5', branch: '#0075FF', singular: '#1B4DFF', kochava: '#2F68D3', adobe: '#FA0F00',
  matomo: '#3152A0', plausible: '#5850EC', posthog: '#1D4AFF', heap: '#6C35F4', segment: '#52BD94', looker: '#669DF6',
};
for (const p of PLATFORMS) { p.logo = LOGO[p.id] || null; p.color = COLOR[p.id] || '#1D1069'; }

export const byId = (id: unknown): Platform | null => PLATFORMS.find(p => p.id === id) || null;
// الخانات اللي تنعرض في وضع "المفتاح يدوي": مع زر الربط تختفي الخانات اللي يجيبها الربط نفسه (manual)
export const keyFields = (p: Platform): Field[] => p.fields;
export const oauthFields = (p: Platform): Field[] => p.fields.filter(f => !f.manual);

// ---- زر "اربط": الطريقة الأساسية لكل منصة تدعم OAuth. الخانات اليدوية بديل إذا الربط ما ضبط.
// app = أسماء متغيرات بيانات التطبيق في بيئة السيرفر. store = وين ينحفظ اللي يرجع (أسماء متغيرات السحب).
export type Values = Record<string, string>;
export interface Exchanged { values: Values; expiresIn?: number | null }
interface ExchangeArgs { code: string; redirect: string; id: string; secret: string }
export interface OAuthCfg {
  authorize: string; token?: string; scope?: string; app: string[]; expires?: string; basic?: boolean; v1?: boolean;
  request?: string; access?: string; extra?: Record<string, string>; store?: Record<string, string>;
  exchange?: (a: ExchangeArgs) => Promise<Exchanged>;
  // bare: رابط التفويض يستخدم app_id و state و redirect_uri فقط (تيك توك). needs: أسماء الخزنة اللازمة لحالة «مربوط».
  bare?: boolean; idName?: string; needs?: string[];
}
const GOOGLE = (scope: string, refresh: string): OAuthCfg => ({ authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope,
  extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' }, app: ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET'], store: { refresh } });

export const OAUTH: Record<string, OAuthCfg> = {
  meta: { authorize: 'https://www.facebook.com/v23.0/dialog/oauth', scope: 'ads_read,ads_management,business_management',
    app: ['META_APP_ID', 'META_APP_SECRET'], expires: 'بعد 60 يوم تقريباً', exchange: metaExchange },
  meta_capi: { authorize: 'https://www.facebook.com/v23.0/dialog/oauth', scope: 'ads_management,business_management',
    app: ['META_APP_ID', 'META_APP_SECRET'], expires: 'بعد 60 يوم تقريباً', exchange: args => metaExchange(args, 'META_CAPI_TOKEN') },
  snap: { authorize: 'https://accounts.snapchat.com/login/oauth2/authorize', token: 'https://accounts.snapchat.com/login/oauth2/access_token', scope: 'snapchat-marketing-api',
    app: ['SNAP_CLIENT_ID', 'SNAP_CLIENT_SECRET'], store: { refresh: 'SNAP_REFRESH_TOKEN', id: 'SNAP_CLIENT_ID', secret: 'SNAP_CLIENT_SECRET' } },
  google_ads: { ...GOOGLE('https://www.googleapis.com/auth/adwords', 'GOOGLE_ADS_REFRESH_TOKEN'), store: { refresh: 'GOOGLE_ADS_REFRESH_TOKEN', id: 'GOOGLE_ADS_CLIENT_ID', secret: 'GOOGLE_ADS_CLIENT_SECRET' } },
  ga4: GOOGLE('https://www.googleapis.com/auth/analytics.readonly', 'GA4_REFRESH_TOKEN'),
  search_console: GOOGLE('https://www.googleapis.com/auth/webmasters.readonly', 'GSC_REFRESH_TOKEN'),
  gtm: GOOGLE('https://www.googleapis.com/auth/tagmanager.readonly', 'GTM_REFRESH_TOKEN'),
  firebase: GOOGLE('https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/firebase.readonly', 'FIREBASE_REFRESH_TOKEN'),
  dv360: GOOGLE('https://www.googleapis.com/auth/display-video', 'DV360_REFRESH_TOKEN'),
  cm360: GOOGLE('https://www.googleapis.com/auth/dfareporting', 'CM360_REFRESH_TOKEN'),
  sa360: GOOGLE('https://www.googleapis.com/auth/doubleclicksearch', 'SA360_REFRESH_TOKEN'),
  looker: GOOGLE('https://www.googleapis.com/auth/bigquery.readonly', 'BIGQUERY_REFRESH_TOKEN'),
  linkedin: { authorize: 'https://www.linkedin.com/oauth/v2/authorization', token: 'https://www.linkedin.com/oauth/v2/accessToken', scope: 'r_ads r_ads_reporting',
    app: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'], store: { refresh: 'LINKEDIN_REFRESH_TOKEN', access: 'LINKEDIN_ACCESS_TOKEN', id: 'LINKEDIN_CLIENT_ID', secret: 'LINKEDIN_CLIENT_SECRET' } },
  pinterest: { authorize: 'https://www.pinterest.com/oauth/', token: 'https://api.pinterest.com/v5/oauth/token', scope: 'ads:read', basic: true,
    app: ['PINTEREST_APP_ID', 'PINTEREST_APP_SECRET'], store: { refresh: 'PINTEREST_REFRESH_TOKEN', id: 'PINTEREST_APP_ID', secret: 'PINTEREST_APP_SECRET' } },
  reddit: { authorize: 'https://www.reddit.com/api/v1/authorize', token: 'https://www.reddit.com/api/v1/access_token', scope: 'adsread', basic: true, extra: { duration: 'permanent' },
    app: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'], store: { refresh: 'REDDIT_REFRESH_TOKEN', id: 'REDDIT_CLIENT_ID', secret: 'REDDIT_CLIENT_SECRET' } },
  microsoft: { authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'https://ads.microsoft.com/msads.manage offline_access', app: ['MSADS_CLIENT_ID', 'MSADS_CLIENT_SECRET'],
    store: { refresh: 'MSADS_REFRESH_TOKEN', id: 'MSADS_CLIENT_ID', secret: 'MSADS_CLIENT_SECRET' } },
  amazon: { authorize: 'https://www.amazon.com/ap/oa', token: 'https://api.amazon.com/auth/o2/token', scope: 'advertising::campaign_management',
    app: ['AMAZON_ADS_CLIENT_ID', 'AMAZON_ADS_CLIENT_SECRET'], store: { refresh: 'AMAZON_ADS_REFRESH_TOKEN', id: 'AMAZON_ADS_CLIENT_ID', secret: 'AMAZON_ADS_CLIENT_SECRET' } },
  yandex: { authorize: 'https://oauth.yandex.com/authorize', token: 'https://oauth.yandex.com/token', scope: '',
    app: ['YANDEX_CLIENT_ID', 'YANDEX_CLIENT_SECRET'], store: { access: 'YANDEX_DIRECT_TOKEN', refresh: 'YANDEX_REFRESH_TOKEN' } },
  // X Ads API: OAuth 1.0a (مو 2.0). الخطوة الأولى request token من السيرفر
  x: { v1: true, request: 'https://api.x.com/oauth/request_token', authorize: 'https://api.x.com/oauth/authorize', access: 'https://api.x.com/oauth/access_token',
    app: ['X_ADS_CONSUMER_KEY', 'X_ADS_CONSUMER_SECRET'], store: { token: 'X_ADS_ACCESS_TOKEN', secret: 'X_ADS_ACCESS_SECRET', id: 'X_ADS_CONSUMER_KEY', key: 'X_ADS_CONSUMER_SECRET' } },
  // المفتاح طويل المدى. أرقام المعلنين أعداد أكبر من Number.MAX_SAFE_INTEGER، فتُقرأ من نص الرد كما هي.
  tiktok: { authorize: 'https://business-api.tiktok.com/portal/auth', bare: true, idName: 'app_id',
    app: ['TIKTOK_APP_ID', 'TIKTOK_APP_SECRET'], needs: ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_IDS'], exchange: tiktokExchange },
};

// بيانات تطبيق المنصة (Client ID/Secret) من بيئة السيرفر. ناقصة = زر الربط ما يشتغل والبديل اليدوي يطلع.
// e = the Worker's env (Cloudflare secrets); the old site read process.env on Vercel.
export const appCreds = (p: Platform, e: Record<string, unknown>): { id: string; secret: string } | null => {
  const [a, b] = OAUTH[p.id]?.app || [];
  const id = a ? String(e[a] ?? '').trim() : '', secret = b ? String(e[b] ?? '').trim() : '';
  return id && secret ? { id, secret } : null;
};

export function authorizeUrl(p: Platform, { id, redirect, state }: { id: string; redirect: string; state: string }): string {
  const o = OAUTH[p.id] as OAuthCfg;
  if (o.bare) {
    const q = new URLSearchParams();
    q.set(o.idName || 'app_id', id);
    q.set('state', state);
    q.set('redirect_uri', redirect);
    return `${o.authorize}?${q}`;
  }
  const q = new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: 'code', state, ...(o.scope ? { scope: o.scope } : {}), ...(o.extra || {}) });
  return `${o.authorize}?${q}`;
}

// OAuth 2.0 العام: code ← refresh token (أو access token إذا المنصة ما تعطي refresh)
export async function exchange(p: Platform, { code, redirect, id, secret }: ExchangeArgs): Promise<Exchanged> {
  const o = OAUTH[p.id] as OAuthCfg;
  if (o.exchange) return o.exchange({ code, redirect, id, secret });
  const body = { grant_type: 'authorization_code', code, redirect_uri: redirect, ...(o.basic ? {} : { client_id: id, client_secret: secret }) };
  const headers: Record<string, string> = o.basic ? { authorization: 'Basic ' + btoa(`${id}:${secret}`) } : {};
  const t = await postForm(o.token as string, body, headers);
  const st = o.store || {}, values: Values = {};
  if (t.refresh_token && st.refresh) values[st.refresh] = String(t.refresh_token);
  if (t.access_token && st.access) values[st.access] = String(t.access_token);
  if (!Object.keys(values).length) throw new Error('no token');
  if (st.id) values[st.id] = id;
  if (st.secret) values[st.secret] = secret;
  return { values, expiresIn: !t.refresh_token && t.expires_in ? Number(t.expires_in) : null };
}

// Spring Rose0406 حساب منفصل ولا يُحفظ مع حسابات ويل. نفس المعرّف في pipeline/tiktok/merge.py.
const TIKTOK_EXCLUDED_ADVERTISERS = new Set(['6948010864247046146']);

function tiktokAdvertiserIds(text: string): string[] {
  const m = text.match(/"advertiser_ids"\s*:\s*\[([\s\S]*?)\]/);
  const body = m?.[1];
  if (!body) return [];
  const ids: string[] = [];
  for (const part of body.split(',')) {
    const id = part.trim().replace(/^"|"$/g, '');
    if (!/^\d+$/.test(id) || TIKTOK_EXCLUDED_ADVERTISERS.has(id) || ids.includes(id)) continue;
    ids.push(id);
  }
  return ids;
}

async function tiktokExchange({ code, id, secret }: ExchangeArgs): Promise<Exchanged> {
  const r = await fetch('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: id, secret, auth_code: code }),
  });
  const text = await r.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { parsed = {}; }
  const data = (parsed.data && typeof parsed.data === 'object' ? parsed.data : {}) as Record<string, unknown>;
  const token = typeof data.access_token === 'string' ? data.access_token.trim() : '';
  const okCode = parsed.code === 0 || parsed.code === '0';
  const advertisers = tiktokAdvertiserIds(text);
  // رسالة الخطأ عامة: جسم الرد فيه المفتاح، وما ينطبع ولا يرجع للمتصفح.
  if (!r.ok || !okCode || !token || !advertisers.length) throw new Error('oauth tiktok');
  return { values: { TIKTOK_ACCESS_TOKEN: token, TIKTOK_ADVERTISER_IDS: advertisers.join(',') } };
}

async function metaExchange({ code, redirect, id, secret }: ExchangeArgs, env = 'META_ACCESS_TOKEN'): Promise<Exchanged> {
  const q = new URLSearchParams({ client_id: id, client_secret: secret, redirect_uri: redirect, code });
  const short = await getJson(`https://graph.facebook.com/v23.0/oauth/access_token?${q}`);
  // المفتاح القصير يعيش ساعة: نبدله بطويل (60 يوم تقريباً)
  const l = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: id, client_secret: secret, fb_exchange_token: String(short.access_token) });
  const long = await getJson(`https://graph.facebook.com/v23.0/oauth/access_token?${l}`);
  return { values: { [env]: String(long.access_token) }, expiresIn: Number(long.expires_in) || 60 * 86400 };
}

// ---- OAuth 1.0a (X): توقيع HMAC-SHA1 حسب RFC 5849
const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
export async function oauth1(url: string, { key, secret, token = '', tokenSecret = '', extra = {} }: { key: string; secret: string; token?: string; tokenSecret?: string; extra?: Record<string, string> }): Promise<Record<string, string>> {
  const o: Record<string, string> = { oauth_consumer_key: key, oauth_nonce: crypto.randomUUID().replace(/-/g, ''), oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_version: '1.0', ...(token ? { oauth_token: token } : {}), ...extra };
  const params = Object.keys(o).sort().map(k => `${pct(k)}=${pct(o[k] as string)}`).join('&');
  const base = `POST&${pct(url)}&${pct(params)}`;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${pct(secret)}&${pct(tokenSecret)}`), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(base)))));
  const auth = 'OAuth ' + Object.entries({ ...o, oauth_signature: sig }).map(([a, b]) => `${pct(a)}="${pct(b)}"`).join(', ');
  const r = await fetch(url, { method: 'POST', headers: { authorization: auth } });
  const text = await r.text();
  if (!r.ok) throw new Error(`oauth1 ${r.status}`);
  return Object.fromEntries(new URLSearchParams(text));
}

type Obj = Record<string, unknown>;
async function getJson(url: string): Promise<Obj> {
  const r = await fetch(url);
  const d = (await r.json().catch(() => ({}))) as Obj;
  if (!r.ok || d.error) throw new Error(`oauth ${r.status}`);
  return d;
}
async function postForm(url: string, body: Record<string, string>, headers: Record<string, string> = {}): Promise<Obj> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body) });
  const d = (await r.json().catch(() => ({}))) as Obj;
  if (!r.ok || d.error) throw new Error(`oauth ${r.status}`);
  return d;
}

// تجربة المفتاح قبل الحفظ، للمنصات اللي نقدر نتأكد منها بطلب قراءة واحد. null = ما فيه تجربة.
export async function check(p: Platform, v: Values): Promise<{ ok: boolean; msg: string } | null> {
  if (p.id === 'meta' && v.META_ACCESS_TOKEN) {
    const acc = (v.META_AD_ACCOUNT_ID || '').trim();
    const path = acc ? `${acc.startsWith('act_') ? acc : 'act_' + acc}?fields=name` : 'me?fields=id';
    const r = await fetch(`https://graph.facebook.com/v23.0/${path}&access_token=${encodeURIComponent(v.META_ACCESS_TOKEN)}`);
    if (!r.ok) return { ok: false, msg: 'Meta رفض المفتاح أو رقم الحساب' };
    const d = (await r.json().catch(() => ({}))) as Obj;
    return { ok: true, msg: d.name ? `Meta: ${d.name}` : 'Meta قبل المفتاح' };
  }
  return null;
}
