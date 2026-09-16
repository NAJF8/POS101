export const categories = ['الكل', 'قهوة مختصة', 'قهوة ساخنة', 'مشروبات باردة', 'مشروبات 101', 'حلويات', 'ساندويتشات', 'إضافات/أخرى']

const rows = [
  ['قهوة مختصة','قهوة مقطرة','V60',7000],['قهوة مختصة','أيروبريس','Aeropress',6000],['قهوة مختصة','كولد برو','Cold Brew',6000],
  ['قهوة ساخنة','اسبرسو سنكل','Single Espresso',3000],['قهوة ساخنة','اسبرسو دبل','Double Espresso',4000],['قهوة ساخنة','أمريكانو','Americano',4500],['قهوة ساخنة','لاتيه كلاسيك','Classic Latte',5000],['قهوة ساخنة','سبانيش لاتيه','Spanish Latte',5500],['قهوة ساخنة','كراميل ماكياتو','Caramel Macchiato',5500],['قهوة ساخنة','لاتيه جوز الهند','Coconut Latte',5500],['قهوة ساخنة','لاتيه فانيلا','Vanilla Latte',5500],['قهوة ساخنة','لاتيه بندق','Hazelnut Latte',5500],['قهوة ساخنة','كابتشينو','Cappuccino',5000],['قهوة ساخنة','فلات وايت','Flat White',5000],['قهوة ساخنة','كورتادو','Cortado',4000],['قهوة ساخنة','موكا','Mocha',5500],['قهوة ساخنة','شاي','Tea',2000],['قهوة ساخنة','قهوة تركية','Turkish Coffee',3000],['قهوة ساخنة','قهوة بالبندق','Hazelnut Coffee',3000],['قهوة ساخنة','قهوة فرنسية','French Coffee',3000],['قهوة ساخنة','هوت شوكليت','Hot Chocolate',5000],
  ['مشروبات باردة','آيس لاتيه كلاسيك','Classic Iced Latte',5000],['مشروبات باردة','آيس سبانيش لاتيه','Spanish Iced Latte',5500],['مشروبات باردة','لاتيه بنكهات','Flavored Latte',5500],['مشروبات باردة','لاتيه فستق','Pistachio Latte',5500],['مشروبات باردة','آيس موكا','Iced Mocha',5500],['مشروبات باردة','ماتشا','Matcha',6500],['مشروبات باردة','سموذي','Smoothie',5500],['مشروبات باردة','ميلك شيك','Milkshake',6000],['مشروبات باردة','آيس تي','Iced Tea',5000],['مشروبات باردة','آيس أمريكانو','Iced Americano',4500],['مشروبات باردة','عصير برتقال','Orange Juice',4500],['مشروبات باردة','ليمون بالنعناع','Mint Lemonade',4500],['مشروبات باردة','حليب بالموز','Banana Milk',4500],['مشروبات باردة','كركديه','Hibiscus',5000],['مشروبات باردة','موهيتو','Mojito',5000],['مشروبات باردة','مشروب مكسيكي','Mexican Drink',4000],
  ['مشروبات 101','سكنجر 101','Skenger 101',5000],['مشروبات 101','فرابيه','Frappe',5500],['مشروبات 101','كولدن شيل','Golden Shake',5500],['مشروبات 101','صيف','Summer',4500],
  ['حلويات','براوني','Brownie',4000],['حلويات','براوني مع آيس كريم','Brownie with Ice Cream',5000],['حلويات','افوكاتو','Affogato',5500],['حلويات','تشيز كيك','Cheesecake',5500],['حلويات','موس كيك','Mousse Cake',5000],['حلويات','سان أوريجينال','San Original',6000],['حلويات','سان بلوبيري','San Blueberry',5500],['حلويات','مافن','Muffin',3000],['حلويات','كوكيز','Cookies',3000],
  ['ساندويتشات','ساندويتشات','Sandwiches',null],['إضافات/أخرى','مياه معدنية','Mineral Water',1000]
]

const imageMap = {
  3:'assets/products/product-3-1789266252641-8b78b619d62c419d7fa91aa6c8ba09a2.png',
  4:'assets/products/product-4-1789266252641-dcc211fbfb06a3d40d11774020f4c6cf.png',
  6:'assets/products/product-6-1789266252641-683e03af752e310ec4966074c7ecc6a8.png',
  7:'assets/products/product-7-1789266252641-bde06f69dcc454d414e34ab89c4f46a7.png',
  8:'assets/products/product-8-1789266252641-53e1e43f06b30f2c4e61ff8235577077.png',
  14:'assets/products/product-14-1789266252641-52861de07e7de19cb58ea925dd2d4a85.png',
  15:'assets/products/product-15-1789266252641-56f649b8bcb232ecd62e1716fe75a6c4.png',
  22:'assets/products/product-22-1789266252641-32b011dbb78eb8f2accd0e3961b6fe0a.png',
  23:'assets/products/product-23-1789266252641-868b4bd74ab33ec3670ccd8a77ee4936.png',
  24:'assets/products/product-24-1789266252641-52f55ab8800e96ea8e70bc797a2b610c.png',
  26:'assets/products/product-26-1789266252641-0ecbe373caf259c128b5dde2fa91067a.png',
  27:'assets/products/product-27-1789266252641-45e6d3e9ba33d7c57598965f9be94451.png',
  28:'assets/products/product-28-1789266252641-64c6802b161a6f46e9cedde1bf7bd15f.png',
  29:'assets/products/product-29-1789266252641-3f683c025dc9b2ecc4c5283ebbc8f42e.png',
  30:'assets/products/product-30-1789266252641-820963972b833b8667f6e64cffafe3dd.png',
  31:'assets/products/product-31-1789266252641-8cc66897266c33e37b4c0a3e1651ebe2.png',
  32:'assets/products/product-32-1789266252641-68f4ff5beee76a23595c48151337f5f2.png',
  33:'assets/products/product-33-1789266252641-47f8ecea709c87f36ed28ce7e3c7f925.png',
  34:'assets/products/product-34-1789266252641-6c8283384799870713ca294c936232f6.png',
  35:'assets/products/product-35-1789266252641-512cf54f5b8893ba62a1af26e3734f6b.png',
  36:'assets/products/product-36-1789266252641-314c2481bc413ffafaf136801d719e13.png',
  42:'assets/products/product-42-1789266252641-c927fe395f9be86394d022179c0f06a3.png',
  43:'assets/products/product-43-1789266252641-86e87f01c3f7b9e539875de40c60b863.png',
  45:'assets/products/product-45-1789266252641-2dd39c667f2ba94662a14f78ed12795e.png',
  47:'assets/products/product-47-1789266252641-c38b269b1fe08c98c3882dc018a61d11.png',
  50:'assets/products/product-49-1789266252641-b7547877e369dd12662c58798f621437.png'
}

export const products = rows.map(([category, name, english, price], index) => ({ id: index + 1, category, name, english, price, image: imageMap[index + 1] ? `${import.meta.env.BASE_URL}${imageMap[index + 1]}` : null, unavailable: price === null, configurable: ['لاتيه كلاسيك','سبانيش لاتيه','لاتيه بنكهات','آيس لاتيه كلاسيك','آيس سبانيش لاتيه','موكا'].includes(name), favorite: index < 6 }))

// The authoritative menu currently stores Arabic in `name` and the optional
// secondary English label in `english`; alternate established keys stay safe.
const hasArabic = value => typeof value === 'string' && /[\u0600-\u06ff]/.test(value)
export const productNames = product => ({
  arabic: [product?.nameAr, product?.name_ar, product?.name].find(hasArabic) || product?.name || '',
  english: [product?.nameEn, product?.name_en, product?.english].find(value => typeof value === 'string' && value.trim()) || ''
})
