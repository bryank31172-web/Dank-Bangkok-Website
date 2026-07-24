/* ============================================================
   DANK BKK — site-wide language picker (i18n.js)
   English is the site's base language. The floating 🌐 button opens
   a picker: English · ไทย · 中文 · Русский · 日本語 · Español.
   Choice persists in localStorage("dankLang"). JS-rendered screens
   are re-translated live via a MutationObserver; switching language
   always restores the English originals first, so text never drifts.
   Phrases not in a dictionary (product names etc.) stay in English.
   ============================================================ */
(function () {
  "use strict";
  if (window.__dankI18n) return; window.__dankI18n = 1;

  var LANGS = [
    { id: "en", flag: "🇬🇧", name: "English", short: "EN" },
    { id: "th", flag: "🇹🇭", name: "ไทย", short: "ไทย" },
    { id: "zh", flag: "🇨🇳", name: "中文", short: "中文" },
    { id: "ru", flag: "🇷🇺", name: "Русский", short: "РУ" },
    { id: "ja", flag: "🇯🇵", name: "日本語", short: "日本語" },
    { id: "es", flag: "🇪🇸", name: "Español", short: "ES" }
  ];

  /* keys are the site's English strings */
  var K = ["Search strains, edibles, drinks…","All branches","Member","member","Shop the menu","Take the quiz","Register free","All types","Featured","Price: low → high","Price: high → low","THC: high → low","Name A→Z","All","Saved","In stock","Sold out","NEW","Add +","Add","from","Relaxed","Happy","Euphoric","Uplifted","Energetic","Creative","Sleepy","Social","Focused","Calm","Hungry","Giggly","Your Cart","Your cart","Your cart is empty.","Browse the menu","Promo code","Apply","Remove","Subtotal","Subtotal (member ⭐)","Delivery","Pickup","Free","Total","Checkout","change","Choose your free 1G","Add any 1g flower to claim your free gram","1st-order gift","On the house","Pickup / Reserve","Your name","Name","Phone","Delivery area","Delivery address","Condo / street / room no.","Pickup branch","Pickup time","e.g. today 7pm","Notes (optional)","Preferred time, gate code, etc.","Payment","Bank transfer","Cash / COD","Card / e-wallet","Card","Crypto","Pay on arrival","Place order & show transfer details","Place order & pay crypto","Card number","Name on card","Order placed!","Payment received!","Done","Upload your payment slip","Tap to upload slip / screenshot","Slip received — we'll confirm","Uploading…","Shop","Full menu","Ask DANK AI","My wallet · top up +10%","Track my order","Help & info","Order on LINE","Visit & Contact","Get directions","Stay in the loop","Be first to know about new strains & exclusive offers.","Your email","Join","For adults 20+. Please consume responsibly.","Free Delivery","On orders over ฿1,500","Earn Points","With every purchase","24/7 Support","We're here for you","Choose Your Weed","How Much Weed?","Add Resin?","Add Hash?","Filter Options","Select Paper","Your Joint Preview","Order Summary","ADD TO CART","Add to Cart","TOTAL","Browse all flowers","Hide flowers","Included","Hand Rolled","By our experts","Custom Made","Just for you","Fresh & Top Shelf","Premium flower","Discreet Packaging","100% discreet","Important Info","Staff login","Enter the staff key to see live customer chats.","Staff key","Enter console","Log out","Chats","Orders","Free gram","Count","Mark done","Reopen","View slip","Upload proof","Recent counts","Backend Connection Status","Re-check","Products","Data source","Print / Save PDF","Category:","Columns:"];

  var V = {
  th: ["ค้นหาสายพันธุ์ ขนม เครื่องดื่ม…","ทุกสาขา","สมาชิก","สมาชิก","ดูเมนู","ทำควิซ","สมัครฟรี","ทุกประเภท","แนะนำ","ราคา: ต่ำ → สูง","ราคา: สูง → ต่ำ","THC: สูง → ต่ำ","ชื่อ A→Z","ทั้งหมด","ที่บันทึก","มีของ","หมด","ใหม่","หยิบ +","เพิ่ม","เริ่ม","ผ่อนคลาย","มีความสุข","เคลิบเคลิ้ม","สดชื่น","กระปรี้กระเปร่า","ครีเอทีฟ","ง่วงสบาย","เข้าสังคม","โฟกัส","ใจสงบ","เจริญอาหาร","ขำง่าย","ตะกร้าของคุณ","ตะกร้าของคุณ","ตะกร้ายังว่างอยู่","ดูเมนูก่อน","โค้ดส่วนลด","ใช้โค้ด","ลบ","ยอดสินค้า","ยอดสินค้า (สมาชิก ⭐)","จัดส่ง","รับที่ร้าน","ฟรี","รวมทั้งหมด","ชำระเงิน","เปลี่ยน","เลือกกรัมฟรีของคุณ","เพิ่มดอก 1g เพื่อรับกรัมฟรี","ของขวัญออเดอร์แรก","ทางร้านเลี้ยง","รับที่ร้าน / จอง","ชื่อของคุณ","ชื่อ","เบอร์โทร","พื้นที่จัดส่ง","ที่อยู่จัดส่ง","คอนโด / ถนน / เลขห้อง","สาขาที่รับ","เวลารับของ","เช่น วันนี้ 1 ทุ่ม","หมายเหตุ (ถ้ามี)","เวลาที่สะดวก, รหัสประตู ฯลฯ","วิธีชำระเงิน","โอนธนาคาร","เงินสด / เก็บปลายทาง","บัตร / e-wallet","บัตรเครดิต","คริปโต","จ่ายตอนรับของ","สั่งซื้อ & ดูบัญชีโอน","สั่งซื้อ & จ่ายคริปโต","เลขบัตร","ชื่อบนบัตร","สั่งซื้อสำเร็จ!","ได้รับเงินแล้ว!","เสร็จสิ้น","อัปโหลดสลิปโอนเงิน","แตะเพื่ออัปโหลดสลิป / ภาพหน้าจอ","ได้รับสลิปแล้ว — รอทีมงานยืนยัน","กำลังอัปโหลด…","ร้านค้า","เมนูทั้งหมด","ถาม DANK AI","วอลเล็ต · เติมเงิน +10%","ติดตามออเดอร์","ช่วยเหลือ & ข้อมูล","สั่งทาง LINE","ที่ตั้ง & ติดต่อ","นำทาง","รับข่าวสาร","รู้ก่อนใครเมื่อมีสายพันธุ์ใหม่และโปรพิเศษ","อีเมลของคุณ","สมัคร","สำหรับผู้ใหญ่ 20+ โปรดใช้อย่างรับผิดชอบ","ส่งฟรี","เมื่อสั่งครบ ฿1,500","สะสมแต้ม","ทุกยอดซื้อ","ดูแล 24 ชม.","พร้อมช่วยเสมอ","เลือกดอก","เลือกปริมาณ","เพิ่มเรซิน?","เพิ่มแฮช?","เลือกฟิลเตอร์","เลือกกระดาษ","พรีวิวจอยท์ของคุณ","สรุปคำสั่งซื้อ","ใส่ตะกร้า","ใส่ตะกร้า","ยอดรวม","ดูดอกทั้งหมด","ซ่อนรายการดอก","รวมแล้ว","มวนด้วยมือ","โดยมืออาชีพ","ทำตามสั่ง","เพื่อคุณโดยเฉพาะ","สดใหม่เกรดท็อป","ดอกพรีเมียม","แพ็คมิดชิด","มิดชิด 100%","ข้อมูลสำคัญ","เข้าสู่ระบบพนักงาน","ใส่รหัสพนักงานเพื่อดูแชทลูกค้าแบบสด","รหัสพนักงาน","เข้าคอนโซล","ออกจากระบบ","แชท","ออเดอร์","กรัมฟรี","นับสต๊อก","เสร็จแล้ว","เปิดใหม่","ดูสลิป","อัปโหลดสลิป","ประวัติการนับ","สถานะการเชื่อมต่อหลังบ้าน","เช็คอีกครั้ง","สินค้า","แหล่งข้อมูล","พิมพ์ / บันทึก PDF","หมวด:","คอลัมน์:"],
  zh: ["搜索品种、食品、饮品…","所有分店","会员","会员","浏览菜单","做测验","免费注册","全部类型","推荐","价格：低 → 高","价格：高 → 低","THC：高 → 低","名称 A→Z","全部","收藏","有货","售罄","新品","加入 +","加入","起","放松","快乐","欣快","振奋","活力","创意","助眠","社交","专注","平静","开胃","傻笑","购物车","购物车","购物车是空的","去逛菜单","优惠码","使用","移除","小计","小计（会员 ⭐）","配送","自取","免费","总计","结账","更换","选择你的免费1克","加购任意1克花即可领取免费一克","首单礼物","本店赠送","自取 / 预订","姓名","姓名","电话","配送区域","配送地址","公寓 / 街道 / 房号","自取分店","自取时间","例如 今晚7点","备注（可选）","方便的时间、门禁密码等","支付方式","银行转账","现金 / 货到付款","银行卡 / 电子钱包","银行卡","加密货币","到付","下单并查看转账信息","下单并用加密货币支付","卡号","持卡人姓名","下单成功！","已收到付款！","完成","上传付款凭证","点击上传凭证 / 截图","已收到凭证 — 我们会尽快确认","上传中…","商店","完整菜单","问 DANK AI","我的钱包 · 充值 +10%","查询订单","帮助与信息","通过 LINE 下单","到店与联系","导航","订阅资讯","新品与专属优惠第一时间知道","你的邮箱","订阅","仅限20岁以上，请理性消费","免费配送","订单满 ฿1,500","积分奖励","每次消费都有","全天候客服","随时为你服务","选择花材","选择克数","加树脂?","加哈希?","选择过滤嘴","选择卷纸","你的卷烟预览","订单摘要","加入购物车","加入购物车","总计","浏览所有花材","收起花材","已包含","手工卷制","由专业师傅","个性定制","专属于你","新鲜顶级","优质花材","隐私包装","100% 保密","重要信息","员工登录","输入员工密钥查看实时客户聊天","员工密钥","进入控制台","退出","聊天","订单","免费克","盘点","完成","重开","查看凭证","上传凭证","盘点记录","后台连接状态","重新检查","商品","数据来源","打印 / 保存PDF","分类：","列数："],
  ru: ["Поиск сортов, еды, напитков…","Все филиалы","Участник","участник","Смотреть меню","Пройти тест","Регистрация бесплатно","Все типы","Рекомендуем","Цена: по возрастанию","Цена: по убыванию","THC: по убыванию","Название A→Z","Все","Избранное","В наличии","Распродано","НОВИНКА","В корзину +","Добавить","от","Расслабление","Радость","Эйфория","Подъём","Энергия","Креатив","Сонливость","Общительность","Фокус","Спокойствие","Аппетит","Смешливость","Ваша корзина","Ваша корзина","Корзина пуста","Смотреть меню","Промокод","Применить","Убрать","Подытог","Подытог (участник ⭐)","Доставка","Самовывоз","Бесплатно","Итого","Оформить","изменить","Выберите бесплатный 1G","Добавьте любой цветок 1g и получите грамм бесплатно","Подарок за первый заказ","За счёт заведения","Самовывоз / Бронь","Ваше имя","Имя","Телефон","Район доставки","Адрес доставки","Дом / улица / квартира","Филиал самовывоза","Время самовывоза","напр. сегодня в 19:00","Комментарий (необязательно)","Удобное время, код домофона и т.д.","Оплата","Банковский перевод","Наличные / при получении","Карта / кошелёк","Карта","Крипто","Оплата при получении","Заказать и показать реквизиты","Заказать и оплатить криптой","Номер карты","Имя на карте","Заказ оформлен!","Оплата получена!","Готово","Загрузите чек об оплате","Нажмите, чтобы загрузить чек","Чек получен — скоро подтвердим","Загрузка…","Магазин","Всё меню","Спросить DANK AI","Кошелёк · пополнение +10%","Отследить заказ","Помощь и инфо","Заказ в LINE","Адрес и контакты","Маршрут","Будьте в курсе","Узнавайте первыми о новых сортах и акциях","Ваш email","Подписаться","Только для взрослых 20+. Употребляйте ответственно","Бесплатная доставка","при заказе от ฿1,500","Бонусные баллы","с каждой покупки","Поддержка 24/7","Мы всегда на связи","Выберите цветок","Сколько грамм?","Добавить смолу?","Добавить гашиш?","Выбор фильтра","Выбор бумаги","Предпросмотр джоинта","Сводка заказа","В КОРЗИНУ","В корзину","ИТОГО","Все цветы","Скрыть цветы","Включено","Ручная крутка","От наших мастеров","Индивидуально","Только для вас","Свежее и топовое","Премиум цветок","Незаметная упаковка","100% конфиденциально","Важная информация","Вход для персонала","Введите ключ персонала, чтобы видеть чаты клиентов","Ключ персонала","Войти","Выйти","Чаты","Заказы","Бесплатный грамм","Учёт","Готово","Открыть снова","Чек","Загрузить чек","История учёта","Статус подключения","Проверить снова","Товары","Источник данных","Печать / PDF","Категория:","Колонки:"],
  ja: ["品種・エディブル・ドリンクを検索…","全店舗","メンバー","メンバー","メニューを見る","クイズで探す","無料登録","全タイプ","おすすめ","価格：安い順","価格：高い順","THC：高い順","名前 A→Z","すべて","お気に入り","在庫あり","売切れ","新着","追加 +","追加","最安","リラックス","ハッピー","多幸感","気分アップ","エナジー","クリエイティブ","眠気","ソーシャル","集中","落ち着き","食欲増進","笑い上戸","カート","カート","カートは空です","メニューを見る","クーポンコード","適用","削除","小計","小計（メンバー ⭐）","配達","店頭受取","無料","合計","レジへ","変更","無料1Gを選ぶ","1gの花を追加で無料1gプレゼント","初回特典","サービス","受取 / 予約","お名前","名前","電話番号","配達エリア","配達先住所","マンション / 通り / 部屋番号","受取店舗","受取時間","例：今日19時","備考（任意）","希望時間・ゲートコード等","お支払い","銀行振込","現金 / 代引き","カード / 電子マネー","カード","仮想通貨","受取時に支払い","注文して振込先を見る","注文して仮想通貨で支払う","カード番号","カード名義","ご注文完了！","お支払い確認！","完了","振込明細をアップロード","タップして明細をアップ","明細を受領 — 確認します","アップロード中…","ショップ","全メニュー","DANK AIに質問","ウォレット · チャージ+10%","注文を追跡","ヘルプ","LINEで注文","店舗・連絡先","道順","最新情報を受取る","新入荷と限定オファーをいち早く","メールアドレス","登録","20歳以上限定。適量でお楽しみください","送料無料","฿1,500以上のご注文で","ポイント獲得","毎回のお買い物で","24時間サポート","いつでもどうぞ","花を選ぶ","グラム数を選ぶ","レジン追加?","ハッシュ追加?","フィルター選択","ペーパー選択","ジョイントプレビュー","注文内容","カートに入れる","カートに入れる","合計","全ての花を見る","花を隠す","込み","ハンドロール","職人による","カスタムメイド","あなただけに","新鮮・最高級","プレミアムフラワー","目立たない梱包","100%プライバシー","重要情報","スタッフログイン","スタッフキーを入力してチャットを表示","スタッフキー","コンソールへ","ログアウト","チャット","注文","無料グラム","棚卸し","完了","再開","明細を見る","証明をアップ","棚卸し履歴","バックエンド接続状況","再チェック","商品","データソース","印刷 / PDF保存","カテゴリ：","列数："],
  es: ["Buscar cepas, comestibles, bebidas…","Todas las sucursales","Miembro","miembro","Ver el menú","Haz el quiz","Regístrate gratis","Todos los tipos","Destacados","Precio: menor → mayor","Precio: mayor → menor","THC: mayor → menor","Nombre A→Z","Todo","Guardados","Disponible","Agotado","NUEVO","Añadir +","Añadir","desde","Relajado","Feliz","Eufórico","Animado","Energético","Creativo","Somnoliento","Social","Concentrado","Tranquilo","Hambriento","Risueño","Tu carrito","Tu carrito","Tu carrito está vacío","Ver el menú","Código promo","Aplicar","Quitar","Subtotal","Subtotal (miembro ⭐)","Envío","Recogida","Gratis","Total","Pagar","cambiar","Elige tu 1G gratis","Añade cualquier flor de 1g y llévate un gramo gratis","Regalo del primer pedido","Invita la casa","Recoger / Reservar","Tu nombre","Nombre","Teléfono","Zona de envío","Dirección de envío","Edificio / calle / n.º","Sucursal de recogida","Hora de recogida","ej. hoy 19:00","Notas (opcional)","Hora preferida, código de puerta, etc.","Pago","Transferencia bancaria","Efectivo / contra entrega","Tarjeta / e-wallet","Tarjeta","Cripto","Pagar al recibir","Pedir y ver datos de transferencia","Pedir y pagar con cripto","Número de tarjeta","Nombre en la tarjeta","¡Pedido realizado!","¡Pago recibido!","Listo","Sube tu comprobante de pago","Toca para subir el comprobante","Comprobante recibido — lo confirmaremos","Subiendo…","Tienda","Menú completo","Pregunta a DANK AI","Mi cartera · recarga +10%","Seguir mi pedido","Ayuda e info","Pedir por LINE","Visítanos y contacto","Cómo llegar","Mantente al día","Sé el primero en saber de nuevas cepas y ofertas","Tu email","Unirme","Solo adultos 20+. Consume responsablemente","Envío gratis","En pedidos de más de ฿1,500","Gana puntos","Con cada compra","Soporte 24/7","Estamos para ti","Elige tu flor","¿Cuánta flor?","¿Añadir resina?","¿Añadir hash?","Opciones de filtro","Elige el papel","Vista previa del porro","Resumen del pedido","AÑADIR AL CARRITO","Añadir al carrito","TOTAL","Ver todas las flores","Ocultar flores","Incluido","Liado a mano","Por expertos","Hecho a medida","Solo para ti","Fresco y de primera","Flor premium","Empaque discreto","100% discreto","Información importante","Acceso del personal","Introduce la clave del personal para ver los chats","Clave del personal","Entrar","Salir","Chats","Pedidos","Gramo gratis","Inventario","Hecho","Reabrir","Ver comprobante","Subir comprobante","Recuentos recientes","Estado de conexión","Verificar de nuevo","Productos","Fuente de datos","Imprimir / Guardar PDF","Categoría:","Columnas:"]
  };

  /* build DICTS[lang] = {english: translated} */
  var DICTS = {};
  for (var lg in V) { var d = {}; for (var i = 0; i < K.length; i++) d[K[i]] = V[lg][i]; DICTS[lg] = d; }

  /* dynamic strings with numbers/amounts — per language */
  var PATTERNS = [
    /^(\d+) items?( · .+)?$/, /^Only (\d+) left$/, /^Discount \((.+)\)$/,
    /^Minimum order (.+) — add (.+) more$/, /^Checkout · (.+)$/, /^Place order · (.+)$/,
    /^Pay (฿[\d,\.]+) from wallet$/, /^Pay (฿[\d,\.]+)$/, /^Wallet (฿[\d,\.]+)$/,
    /^Free gram added: (.+?) — ?$/
  ];
  var REPL = {
    th: ["$1 รายการ$2","เหลือ $1 ชิ้นสุดท้าย","ส่วนลด ($1)","สั่งขั้นต่ำ $1 — เพิ่มอีก $2","ชำระเงิน · $1","สั่งซื้อ · $1","จ่าย $1 จากวอลเล็ต","จ่าย $1","วอลเล็ต $1","ได้กรัมฟรี: $1 — "],
    zh: ["$1 件$2","仅剩 $1 件","折扣（$1）","最低消费 $1 — 还差 $2","结账 · $1","下单 · $1","用钱包支付 $1","支付 $1","钱包 $1","已加免费克：$1 — "],
    ru: ["$1 поз.$2","Осталось $1","Скидка ($1)","Мин. заказ $1 — добавьте ещё $2","Оформить · $1","Заказать · $1","Оплатить $1 из кошелька","Оплатить $1","Кошелёк $1","Бесплатный грамм: $1 — "],
    ja: ["$1 件$2","残り$1点","割引（$1）","最低注文 $1 — あと $2","レジへ · $1","注文する · $1","ウォレットで $1 支払う","$1 を支払う","ウォレット $1","無料1g追加：$1 — "],
    es: ["$1 artículos$2","Solo quedan $1","Descuento ($1)","Pedido mínimo $1 — añade $2 más","Pagar · $1","Pedir · $1","Pagar $1 con la cartera","Pagar $1","Cartera $1","Gramo gratis: $1 — "]
  };

  var LKEY = "dankLang";
  var lang = "en";
  try { lang = localStorage.getItem(LKEY) || "en"; } catch (e) {}
  if (!DICTS[lang] && lang !== "en") lang = "en";
  var savedText = new Map(), savedAttr = new Map();
  var observer = null, busy = false;
  var ATTRS = ["placeholder", "title"];
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1 };

  function trStr(s) {
    if (lang === "en") return null;
    var DICT = DICTS[lang], RULES = REPL[lang];
    var t = s.trim(); if (!t) return null;
    if (DICT[t]) return s.replace(t, DICT[t]);
    var p = "", x = "", core = t;
    var pre = core.match(/^[^A-Za-z]+/);
    if (pre) { p = pre[0]; core = core.slice(p.length); }
    var suf = core.match(/[^A-Za-z!?.%)]+$/);
    if (suf) { x = suf[0]; core = core.slice(0, core.length - x.length); }
    if (core && DICT[core]) return s.replace(t, p + DICT[core] + x);
    for (var i = 0; i < PATTERNS.length; i++) {
      if (PATTERNS[i].test(t)) return s.replace(t, t.replace(PATTERNS[i], RULES[i]));
    }
    return null;
  }

  function walk(root, fn) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var el = n.parentNode;
        if (!el || SKIP[el.nodeName]) return NodeFilter.FILTER_REJECT;
        if (el.closest && el.closest("#langBtn,#langMenu")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n; while ((n = w.nextNode())) fn(n);
  }

  function translate(root) {
    walk(root, function (n) {
      var out = trStr(n.nodeValue);
      if (out !== null) { if (!savedText.has(n)) savedText.set(n, n.nodeValue); n.nodeValue = out; }
    });
    var els = root.querySelectorAll ? root.querySelectorAll("[placeholder],[title]") : [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      for (var a = 0; a < ATTRS.length; a++) {
        var at = ATTRS[a], v = el.getAttribute(at); if (!v) continue;
        var out = trStr(v);
        if (out !== null) {
          var rec = savedAttr.get(el) || {}; if (!(at in rec)) { rec[at] = v; savedAttr.set(el, rec); }
          el.setAttribute(at, out);
        }
      }
    }
  }

  function restoreAll() {
    savedText.forEach(function (orig, n) { try { n.nodeValue = orig; } catch (e) {} });
    savedAttr.forEach(function (rec, el) { for (var a in rec) { try { el.setAttribute(a, rec[a]); } catch (e) {} } });
    savedText = new Map(); savedAttr = new Map();
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(function () {
      if (busy || lang === "en") return;
      busy = true;
      try { translate(document.body); } finally { observer.takeRecords(); busy = false; }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  function stopObserver() { if (observer) { observer.disconnect(); observer = null; } }

  function applyLang(next) {
    busy = true;
    try {
      if (lang !== "en") { stopObserver(); restoreAll(); }   // back to English originals first
      lang = next;
      try { localStorage.setItem(LKEY, lang); } catch (e) {}
      document.documentElement.lang = lang;
      if (lang !== "en") { translate(document.body); startObserver(); }
    } finally { if (observer) observer.takeRecords(); busy = false; }
    var btn = document.getElementById("langBtn");
    if (btn) {
      var cur = LANGS.filter(function (l) { return l.id === lang; })[0] || LANGS[0];
      btn.textContent = "🌐 " + cur.short;
    }
    closeMenu();
  }

  /* ---- picker UI ---- */
  function closeMenu() { var m = document.getElementById("langMenu"); if (m) m.remove(); }
  function openMenu() {
    if (document.getElementById("langMenu")) { closeMenu(); return; }
    var btn = document.getElementById("langBtn");
    var m = document.createElement("div");
    m.id = "langMenu";
    m.style.cssText = "position:fixed;left:14px;bottom:" + (parseInt(btn.style.bottom, 10) + 46) + "px;" +
      "z-index:2147483001;background:#0e1a11;border:1px solid #2f8a33;border-radius:14px;overflow:hidden;" +
      "box-shadow:0 14px 44px rgba(0,0,0,.55);min-width:170px;font:600 14px/1 'Segoe UI',system-ui,sans-serif";
    LANGS.forEach(function (l) {
      var r = document.createElement("button");
      r.type = "button";
      r.textContent = l.flag + "  " + l.name + (l.id === lang ? "  ✓" : "");
      r.style.cssText = "display:block;width:100%;text-align:left;padding:12px 16px;border:none;cursor:pointer;" +
        "background:" + (l.id === lang ? "rgba(61,220,132,.16)" : "transparent") + ";color:" + (l.id === lang ? "#7be389" : "#e8f5ec");
      r.onmouseover = function () { r.style.background = "rgba(61,220,132,.12)"; };
      r.onmouseout = function () { r.style.background = l.id === lang ? "rgba(61,220,132,.16)" : "transparent"; };
      r.onclick = function (ev) { ev.stopPropagation(); applyLang(l.id); };
      m.appendChild(r);
    });
    document.body.appendChild(m);
    setTimeout(function () {
      document.addEventListener("click", function h(ev) {
        if (!m.contains(ev.target) && ev.target.id !== "langBtn") { closeMenu(); document.removeEventListener("click", h); }
      });
    }, 0);
  }

  function makeButton() {
    if (document.getElementById("langBtn")) return;
    var b = document.createElement("button");
    b.id = "langBtn"; b.type = "button";
    var cur = LANGS.filter(function (l) { return l.id === lang; })[0] || LANGS[0];
    b.textContent = "🌐 " + cur.short;
    var lift = document.querySelector(".mcart") ? "96" : "14";
    b.style.cssText = "position:fixed;left:14px;bottom:" + lift + "px;z-index:2147483000;" +
      "background:#0e1a11;color:#7be389;border:1px solid #2f8a33;border-radius:999px;" +
      "padding:9px 14px;font:700 13px/1 'Segoe UI',system-ui,sans-serif;cursor:pointer;" +
      "box-shadow:0 6px 20px rgba(0,0,0,.45)";
    b.onclick = function (ev) { ev.stopPropagation(); openMenu(); };
    document.body.appendChild(b);
  }

  function boot() {
    makeButton();
    if (lang !== "en") { var keep = lang; lang = "en"; applyLang(keep); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
