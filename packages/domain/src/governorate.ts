/**
 * Gouvernorat tunisien à partir du champ « ville » d'une commande, pour les signaux par zone (L2).
 * Le champ vient du formulaire de la boutique : nom du gouvernorat en français ou en arabe,
 * parfois suivi de la délégation (« Tunis - La Marsa »). Une ville non reconnue donne null.
 */
export const TN_GOVERNORATES = [
  'Ariana',
  'Béja',
  'Ben Arous',
  'Bizerte',
  'Gabès',
  'Gafsa',
  'Jendouba',
  'Kairouan',
  'Kasserine',
  'Kébili',
  'Le Kef',
  'Mahdia',
  'La Manouba',
  'Médenine',
  'Monastir',
  'Nabeul',
  'Sfax',
  'Sidi Bouzid',
  'Siliana',
  'Sousse',
  'Tataouine',
  'Tozeur',
  'Tunis',
  'Zaghouan',
] as const;

export type TnGovernorate = (typeof TN_GOVERNORATES)[number];

const ALIASES: Record<TnGovernorate, readonly string[]> = {
  Ariana: ['ariana', 'aryana', 'أريانة'],
  Béja: ['beja', 'باجة'],
  'Ben Arous': ['ben arous', 'benarous', 'بن عروس'],
  Bizerte: ['bizerte', 'bizerta', 'بنزرت'],
  Gabès: ['gabes', 'قابس'],
  Gafsa: ['gafsa', 'قفصة'],
  Jendouba: ['jendouba', 'جندوبة'],
  Kairouan: ['kairouan', 'kairaouan', 'القيروان'],
  Kasserine: ['kasserine', 'القصرين'],
  Kébili: ['kebili', 'قبلي'],
  'Le Kef': ['le kef', 'el kef', 'kef', 'الكاف'],
  Mahdia: ['mahdia', 'المهدية'],
  'La Manouba': ['la manouba', 'manouba', 'منوبة'],
  Médenine: ['medenine', 'mednine', 'مدنين'],
  Monastir: ['monastir', 'المنستير'],
  Nabeul: ['nabeul', 'نابل'],
  Sfax: ['sfax', 'صفاقس'],
  'Sidi Bouzid': ['sidi bouzid', 'سيدي بوزيد'],
  Siliana: ['siliana', 'سليانة'],
  Sousse: ['sousse', 'سوسة'],
  Tataouine: ['tataouine', 'تطاوين'],
  Tozeur: ['tozeur', 'توزر'],
  Tunis: ['tunis', 'تونس'],
  Zaghouan: ['zaghouan', 'زغوان'],
};

function normalize(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ًͯ-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(gouvernorat de|gouvernorat|ولايه)\s+/, '');
}

// Alias les plus longs d'abord : « sidi bouzid » avant « tunis », « le kef » avant « kef ».
const LOOKUP: ReadonlyArray<[string, TnGovernorate]> = Object.entries(ALIASES)
  .flatMap(([gov, aliases]) =>
    aliases.map((a) => [normalize(a), gov as TnGovernorate] as [string, TnGovernorate]),
  )
  .sort((a, b) => b[0].length - a[0].length);

export function toGovernorate(city: string | null | undefined): TnGovernorate | null {
  if (!city) return null;
  const s = normalize(city);
  if (!s) return null;
  for (const [alias, gov] of LOOKUP) {
    if (s === alias || s.startsWith(`${alias} `)) return gov;
  }
  return null;
}
