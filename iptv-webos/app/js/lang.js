/*
 * Language / quality detection from IPTV category and title labels such as
 * "EN | Action", "|FR| Films", "[DE] Serien", "4K-EN", "HINDI MOVIES",
 * "EN - The Odyssey (2026)", "The.Odyssey.2026.HDCAM".
 */
(function (global) {
  'use strict';

  var NAMES = {
    en: 'English', fr: 'French', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese',
    ar: 'Arabic', tr: 'Turkish', nl: 'Dutch', pl: 'Polish', ru: 'Russian', hi: 'Hindi', pa: 'Punjabi',
    ur: 'Urdu', fa: 'Persian', el: 'Greek', ro: 'Romanian', sq: 'Albanian', sv: 'Swedish', no: 'Norwegian',
    da: 'Danish', fi: 'Finnish', hu: 'Hungarian', cs: 'Czech', exyu: 'Ex-Yu', ku: 'Kurdish', he: 'Hebrew',
    zh: 'Chinese', ja: 'Japanese', ko: 'Korean', th: 'Thai', vi: 'Vietnamese', tl: 'Filipino', bn: 'Bengali',
    ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', so: 'Somali', am: 'Amharic'
  };

  // Codes that appear as a delimited label ("EN |", "[FR]", "4K-DE")
  var CODES = {
    EN: 'en', ENG: 'en', UK: 'en', US: 'en', USA: 'en', GB: 'en', CA: 'en', AU: 'en', NZ: 'en', IE: 'en',
    FR: 'fr', FRA: 'fr', VF: 'fr', VOSTFR: 'fr', QC: 'fr',
    ES: 'es', ESP: 'es', LAT: 'es', LATINO: 'es', MX: 'es',
    DE: 'de', GER: 'de', AT: 'de', IT: 'it', ITA: 'it',
    PT: 'pt', POR: 'pt', BR: 'pt', AR: 'ar', ARA: 'ar', ARAB: 'ar',
    TR: 'tr', TUR: 'tr', NL: 'nl', NLD: 'nl', PL: 'pl', POL: 'pl', RU: 'ru', RUS: 'ru',
    IN: 'hi', HIN: 'hi', IND: 'hi', PK: 'ur', IR: 'fa', FA: 'fa', GR: 'el', GRE: 'el',
    RO: 'ro', ROM: 'ro', AL: 'sq', ALB: 'sq', SE: 'sv', SWE: 'sv', NO: 'no', NOR: 'no',
    DK: 'da', DAN: 'da', FI: 'fi', FIN: 'fi', HU: 'hu', HUN: 'hu', CZ: 'cs', CZE: 'cs',
    EXYU: 'exyu', YU: 'exyu', HR: 'exyu', RS: 'exyu', BA: 'exyu', KU: 'ku', KUR: 'ku',
    IL: 'he', HEB: 'he', CN: 'zh', CHN: 'zh', JP: 'ja', KR: 'ko', KOR: 'ko', TH: 'th',
    VN: 'vi', VIE: 'vi', PH: 'tl', BD: 'bn', SO: 'so', ET: 'am'
  };
  // Two-letter codes that are also ordinary words, only trusted when delimited
  var AMBIGUOUS = { IT: 1, IN: 1, NO: 1, AL: 1, AT: 1, CA: 1, US: 1, DE: 1, ES: 1, SO: 1, ET: 1, IL: 1, BA: 1, PH: 1, TH: 1 };

  // Whole words, used for category names only (a film called "French Kiss" isn't French)
  var WORDS = [
    [/\b(ENGLISH|AMERICAN|BRITISH|CANADA)\b/, 'en'],
    [/\b(FRENCH|FRANCAIS|FRANCE)\b/, 'fr'],
    [/\b(SPANISH|ESPANOL|LATINO|LATINA|SPAIN|ESPANA|MEXICO)\b/, 'es'],
    [/\b(GERMAN|DEUTSCH|GERMANY|DEUTSCHLAND)\b/, 'de'],
    [/\b(ITALIAN|ITALIANO|ITALIA|ITALY)\b/, 'it'],
    [/\b(PORTUGUESE|PORTUGUES|BRASIL|BRAZIL|PORTUGAL)\b/, 'pt'],
    [/\b(ARABIC|ARABE|ARAB)\b/, 'ar'],
    [/\b(TURKISH|TURKIYE|TURKEY|TURK)\b/, 'tr'],
    [/\b(DUTCH|NEDERLAND|NETHERLANDS)\b/, 'nl'],
    [/\b(POLISH|POLSKA|POLAND)\b/, 'pl'],
    [/\b(RUSSIAN|RUSSIA)\b/, 'ru'],
    [/\b(HINDI|INDIAN|INDIA|BOLLYWOOD)\b/, 'hi'],
    [/\bPUNJABI\b/, 'pa'], [/\b(URDU|PAKISTAN)\b/, 'ur'],
    [/\b(PERSIAN|FARSI|IRAN)\b/, 'fa'], [/\b(GREEK|GREECE)\b/, 'el'],
    [/\b(ROMANIAN|ROMANIA)\b/, 'ro'], [/\b(ALBANIAN|ALBANIA|SHQIP)\b/, 'sq'],
    [/\b(SWEDISH|SWEDEN|SVENSK)\b/, 'sv'], [/\b(NORWEGIAN|NORWAY|NORSK)\b/, 'no'],
    [/\b(DANISH|DENMARK)\b/, 'da'], [/\b(FINNISH|FINLAND)\b/, 'fi'],
    [/\b(HUNGARIAN|HUNGARY)\b/, 'hu'], [/\b(CZECH)\b/, 'cs'],
    [/\b(EX-?YU|BALKAN|SERBIAN|CROATIAN|BOSNIAN)\b/, 'exyu'],
    [/\b(KURDISH)\b/, 'ku'], [/\b(HEBREW|ISRAEL)\b/, 'he'],
    [/\b(CHINESE|CHINA|MANDARIN|CANTONESE)\b/, 'zh'], [/\b(JAPANESE|JAPAN)\b/, 'ja'],
    [/\b(KOREAN|KOREA|K-?DRAMA)\b/, 'ko'], [/\b(THAI|THAILAND)\b/, 'th'],
    [/\b(VIETNAMESE|VIETNAM)\b/, 'vi'], [/\b(FILIPINO|PINOY|PHILIPPINES|TAGALOG)\b/, 'tl'],
    [/\b(BENGALI|BANGLA)\b/, 'bn'], [/\bTAMIL\b/, 'ta'], [/\bTELUGU\b/, 'te'], [/\bMALAYALAM\b/, 'ml'],
    [/\b(SOMALI)\b/, 'so'], [/\b(AMHARIC|ETHIOPIA)\b/, 'am']
  ];

  var LABEL_WORDS = { '4K': 1, UHD: 1, FHD: 1, HD: 1, SD: 1, VOD: 1, NEW: 1, TOP: 1, MULTI: 1, SUB: 1, SUBS: 1, TV: 1, LIVE: 1 };
  // One leading label plus the delimiter after it: "EN | ", "[FR] ", "4K-", "|DE|"
  var LABEL_RE = /^[\s|\[\]{}*#★•»]*([A-Z0-9]{2,6})\s*([|\]:\-–—»•\/}]+|$)/;

  function upper(s) {
    s = String(s || '').toUpperCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s;
  }

  // Read the labels at the start of a string. Words like IT / US / IN only count
  // as languages with a hard delimiter after them ("IT |"), so "It (2017)" or
  // "Us - Director's Cut" aren't mistaken for Italian / English.
  function fromLabels(text, isCategory) {
    var rest = upper(text);
    for (var i = 0; i < 3; i++) {
      var m = LABEL_RE.exec(rest);
      if (!m) break;
      var tok = m[1];
      var delim = m[2];
      if (CODES[tok] && (!AMBIGUOUS[tok] || /[|\]:]/.test(delim) || (isCategory && delim) || (delim === '' && i > 0))) return CODES[tok];
      if (!LABEL_WORDS[tok]) break;
      rest = rest.slice(m[0].length);
    }
    // "EN The Odyssey" / "DE Filme": a leading code with no delimiter
    var words = upper(text).trim().split(/\s+/);
    var first = words[0];
    if (words.length > 1 && CODES[first] && (!AMBIGUOUS[first] || (isCategory && !/^(IT|IN|NO|US|AT|SO|ET|IL|TH)$/.test(first)))) return CODES[first];
    return '';
  }

  function detectCategory(name) {
    var code = fromLabels(name, true);
    if (code) return code;
    var u = upper(name);
    for (var i = 0; i < WORDS.length; i++) if (WORDS[i][0].test(u)) return WORDS[i][1];
    return '';
  }

  function detectTitle(name) {
    return fromLabels(name, false);
  }

  function quality(text) {
    var u = upper(text).replace(/[._]/g, ' ');
    if (/\b(HD ?CAM|CAM ?RIP|CAM|HDTS|TELESYNC)\b/.test(u)) return 'CAM';
    if (/\b(4K|UHD|2160P?)\b/.test(u)) return '4K';
    if (/\b(FHD|1080P?)\b/.test(u)) return 'FHD';
    if (/\b(HD|720P?)\b/.test(u)) return 'HD';
    if (/\bSD\b/.test(u)) return 'SD';
    return '';
  }

  // Strip labels, quality tags and a trailing year so titles compare cleanly:
  // "EN - The Odyssey (2026) 4K" -> "the odyssey"
  function cleanTitle(name) {
    var s = upper(name).replace(/[._]/g, ' ');
    var hard = /^\s*[|\[]/.test(s) || /^\s*[A-Z0-9]{2,6}\s*[|\]:]/.test(s);
    var segs = s.split(/\s*[|\[\]]\s*|\s*[-–—:]\s*(?=\S)/).filter(function (x) { return x.trim(); });
    // Drop leading segments that are just labels ("EN", "4K", "VOD EN"); "It - Chapter Two" keeps "It"
    while (segs.length > 1 && segs[0].trim().split(/\s+/).every(function (w) {
      return (CODES[w] && (hard || !AMBIGUOUS[w])) || /^(4K|UHD|FHD|HD|SD|VOD|MULTI|SUB|NEW)$/.test(w);
    })) {
      segs.shift();
    }
    s = segs.join(' ');
    // "EN The Odyssey"
    var w = s.trim().split(/\s+/);
    if (w.length > 1 && CODES[w[0]] && !AMBIGUOUS[w[0]]) s = w.slice(1).join(' ');
    s = s.replace(/\((19|20)\d{2}\)/g, ' ');
    s = s.replace(/\b(4K|UHD|2160P?|FHD|1080P?|720P?|HD ?CAM|CAM ?RIP|HDTS|HDRIP|WEB-?DL|WEBRIP|BLURAY|X264|X265|HEVC|MULTI[- ]?SUBS?|MULTI|VOSTFR|DUAL|SUBBED|DUBBED)\b/g, ' ');
    s = s.replace(/\(?\b(19|20)\d{2}\b\)?\s*$/, ' ').replace(/\(\s*\)/g, ' ');
    s = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    // "odyssey, the" -> "the odyssey"
    var m = /^(.*) (the|a|an)$/.exec(s);
    if (m) s = m[2] + ' ' + m[1];
    return s;
  }

  global.Lang = {
    NAMES: NAMES,
    name: function (code) { return code ? (NAMES[code] || code.toUpperCase()) : 'Unlabeled'; },
    detectCategory: detectCategory,
    detectTitle: detectTitle,
    quality: quality,
    cleanTitle: cleanTitle
  };
})(window);
