const fakeSale = {
  orderNumber: 'P-0017', seller: 'كاشير تجريبي', orderType: 'داخل الكوفي',
  payment: 'نقدي', createdAt: '2026-09-21 12:30',
  items: [
    { name: 'لاتيه عربي', quantity: 2, price: 5000 },
    { name: 'كرواسون زعتر', quantity: 1, price: 3500 },
    { name: 'ماء', quantity: 1, price: 750 }
  ], subtotal: 14250, discount: 0, total: 14250
};

const fakeReport = {
  title: 'تقرير العمليات التجريبي', period: '2026-09-21',
  sales: [
    { order: 'P-0017', time: '12:30', cashier: 'كاشير تجريبي', method: 'نقدي', total: 14250 },
    { order: 'P-0018', time: '12:44', cashier: 'كاشير تجريبي', method: 'إلكتروني', total: 8750 },
    { order: 'P-0019', time: '13:02', cashier: 'كاشير تجريبي', method: 'نقدي', total: 11250 }
  ], total: 34250
};

module.exports = { fakeSale, fakeReport };
