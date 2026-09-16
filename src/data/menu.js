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
  1:'assets/products/product-1-1789371652167-96a43c1066ab422aa6e8d5bad75ff6f5.png',
  2:'assets/products/product-2-1789371676802-86af9c9946294c29b95cb19b326093c2.png',
  3:'assets/products/product-3-1789371827193-c449f45030b24907a99e884d3cf30809.png',
  4:'assets/products/product-4-1789372133049-2068eee76d42435087bb0f9916f44d56.png',
  5:'assets/products/1789205205040-859e91bf9260472ca570f401a92c389b.png',
  6:'assets/products/product-6-1789372149322-d8bf6c853c494c749bfea146495344c6.png',
  7:'assets/products/product-7-1789372168004-274bdff1499c4daf8dda387ce1405cff.png',
  8:'assets/products/product-8-1789372184301-308a38277bb94204a5202cb8f95f2d33.png',
  9:'assets/products/1789205520251-6db7d5c346ff49b8aa03479e94ab0145.png',
  10:'assets/products/product-10-1789372203210-30ab153c1e1f4f809d53af7d195eeb80.png',
  11:'assets/products/product-11-1789372215243-3db744d21214413da6da2ed25aff3469.png',
  12:'assets/products/product-12-1789372229458-5d3f3364835b4155a61cddb7a62dfa54.png',
  13:'assets/products/1789205497174-3eb70bd69c074083a32bbd6b72f08ea3.png',
  14:'assets/products/product-14-1789372243666-0a668158d8124f91b6fac05fcfd34557.png',
  15:'assets/products/product-15-1789372404163-b10455201be14e6496ec6be7a79d7894.png',
  16:'assets/products/product-16-1789372421324-24453eef807546f094fe2f8173c2e447.png',
  17:'assets/products/1789205563207-2f2060463a7c4c13bc73a660aadd1043.png',
  18:'assets/products/product-18-1789383231743-a26490e5a0cd4b5b8c4034d221dd23c4.png',
  19:'assets/products/product-19-1789373556937-7ca22c1fa2a548b998ba0555de4a915f.png',
  20:'assets/products/product-20-1789373544571-daddab5d56074c078631baf7b509fb50.png',
  21:'assets/products/product-21-1789372442874-10e04313037e45b58f599af644fa8a07.png',
  22:'assets/products/product-22-1789372468761-4a0cfa63a1624018a1e0e18214cba467.png',
  23:'assets/products/product-23-1789372488888-5db398b3f9724994b2549beea8a06570.png',
  24:'assets/products/product-24-1789372512689-3ebe51a4890d46beaadb11ddb740e875.png',
  25:'assets/products/product-25-1789372565923-d2e3ee1c71ef4ee4b97bc392abdba857.png',
  26:'assets/products/product-26-1789372609837-dda222af9ad24c19911acb45a523761d.png',
  27:'assets/products/product-27-1789372955554-946bb1e8a7204bb9a66cf6a177e6a676.png',
  28:'assets/products/product-28-1789372971202-61ff9c05d13c4aa3aed24b8410245499.png',
  29:'assets/products/product-29-1789372689450-8eb0868c842f4ea7a1529c4154f99c55.png',
  30:'assets/products/product-30-1789373144621-bf9f8121feb843f49e8ca6bb6d438acb.png',
  31:'assets/products/product-31-1789372711724-c0afd9a801254aa985d980d86ae107db.png',
  32:'assets/products/product-32-1789373166672-03bdc1f14b43436985a06a917ad8c352.png',
  33:'assets/products/product-33-1789373201445-feae8949cb3f415fb373f95c6d8d3d70.png',
  34:'assets/products/product-34-1789373087677-23dbcde0d8fe465d873750006cc7d083.png',
  35:'assets/products/product-35-1789372920685-e3045c5406f941f687aa31a1e29e2f66.png',
  36:'assets/products/product-36-1789372941901-aef957dbd170441fbc2cd017710fd4f9.png',
  38:'assets/products/product-38-1789372890423-9a1d3d53dbae44fca42601526578da58.png',
  42:'assets/products/1789207240024-f87315c864c74ca6b3c36cceb8be88e1.jpg',
  43:'assets/products/product-43-1789373315761-0922c91316f54b6ab275575043a7f8f3.png',
  45:'assets/products/product-45-1789373299481-c8fde71e936e486087fa9d18a6ecda4b.png',
  46:'assets/products/product-46-1789373224078-fb9c2f247b53446384b12e8313e2564c.png',
  47:'assets/products/product-47-1789373402430-6e8569e2119b4129b919e9482693a43d.png',
  49:'assets/products/product-49-1789373372311-d372833775a3484a88d932fc7ca6082b.png',
  50:'assets/products/1789207678103-2c05a4ed28a64c75bc307ca1d0ab0378.png',
}

export const products = rows.map(([category, name, english, price], index) => ({ id: index + 1, category, name, english, price, image: imageMap[index + 1] ? `${import.meta.env.BASE_URL}${imageMap[index + 1]}` : null, unavailable: price === null, configurable: ['لاتيه كلاسيك','سبانيش لاتيه','لاتيه بنكهات','آيس لاتيه كلاسيك','آيس سبانيش لاتيه','موكا'].includes(name), favorite: index < 6 }))

// The authoritative menu currently stores Arabic in `name` and the optional
// secondary English label in `english`; alternate established keys stay safe.
const hasArabic = value => typeof value === 'string' && /[\u0600-\u06ff]/.test(value)
export const productNames = product => ({
  arabic: [product?.nameAr, product?.name_ar, product?.name].find(hasArabic) || product?.name || '',
  english: [product?.nameEn, product?.name_en, product?.english].find(value => typeof value === 'string' && value.trim()) || ''
})
