"""Generate the original vector wiring guide. Requires reportlab and a Cyrillic TTF."""
from pathlib import Path
import os
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4, landscape

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 'pdf' / 'folium-wiring.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
font_dir = Path(os.environ.get('FOLIUM_FONT_DIR', 'C:/Windows/Fonts'))
pdfmetrics.registerFont(TTFont('Body', str(font_dir / 'arial.ttf')))
pdfmetrics.registerFont(TTFont('Bold', str(font_dir / 'arialbd.ttf')))
W, H = landscape(A4)
c = canvas.Canvas(str(OUT), pagesize=(W,H))
c.setTitle('Folium - ESP32, sensors and two pump channels')
c.setAuthor('Vasiliev Nichita')
INK='#233B32'; GREEN='#397357'; MUTED='#62736A'; PALE='#F1F5EF'; RED='#B94F38'; BLUE='#377897'; GRAY='#59636A'

def text(x,y,s,size=11,bold=False,color=INK):
    c.setFillColor(HexColor(color));c.setFont('Bold' if bold else 'Body',size);c.drawString(x,H-y,s)
def line(x1,y1,x2,y2,color=INK,width=1.4,dash=False):
    c.setStrokeColor(HexColor(color));c.setLineWidth(width);c.setDash(4,3) if dash else c.setDash()
    c.line(x1,H-y1,x2,H-y2);c.setDash()
def box(x,y,w,h,fill=PALE,stroke='#C7D6CA'):
    c.setFillColor(HexColor(fill));c.setStrokeColor(HexColor(stroke));c.setLineWidth(1)
    c.roundRect(x,H-y-h,w,h,7,fill=1,stroke=1)
def dot(x,y,color=INK):
    c.setFillColor(HexColor(color));c.circle(x,H-y,2.7,stroke=0,fill=1)
def ground(x,y):
    line(x,y,x,y+7,GRAY)
    for i,w in enumerate([16,10,4]):line(x-w/2,y+7+i*4,x+w/2,y+7+i*4,GRAY)
def res_h(x,y,label):
    line(x,y,x+10,y);c.setStrokeColor(HexColor(INK));c.rect(x+10,H-y-4,34,8,fill=0,stroke=1);line(x+44,y,x+54,y)
    text(x+8,y-10,label,10)
def res_v(x,y,label):
    line(x,y,x,y+10);c.setStrokeColor(HexColor(INK));c.rect(x-4,H-y-44,8,34,fill=0,stroke=1);line(x,y+44,x,y+54)
    text(x+10,y+30,label,10)
def cap_v(x,y,label):
    line(x,y,x,y+15);line(x-8,y+15,x+8,y+15);line(x-8,y+21,x+8,y+21);line(x,y+21,x,y+40)
    text(x+12,y+24,label,10)
def header(n,title,sub):
    c.setFillColor(HexColor('#FCFBF6'));c.rect(0,0,W,H,fill=1,stroke=0)
    text(32,34,'FOLIUM / HARDWARE 0.3',10,True,GREEN)
    text(32,67,title,24,True);text(32,91,sub,10,color=MUTED)
    line(32,108,W-32,108,'#D5DDD4',.8)
    line(32,H-33,W-32,H-33,'#D5DDD4',.8)
    text(32,H-18,'ESP32-WROOM / 5 V pumps / проект до физических испытаний / 10.10.2026',9,color=MUTED)
    text(W-67,H-18,f'{n} / 4',9,color=MUTED)
def note(x,y,rows,size=11):
    for i,s in enumerate(rows):text(x,y+i*17,s,size)
def label_wire(x1,y1,x2,y2,label=None,color=BLUE):
    line(x1,y1,x2,y2,color,1.8)
    if label:text(x1+6,y1-8,label,9,color=color)

# 1: overview, deliberately using functional blocks rather than a clone's header positions.
header(1,'Карта подключения','Два активных канала. Три подписанные пробы остаются в своих горшках. Номера означают GPIO.')
for y,title,sub in [(143,'Горшок 1 / S-01','Хлорофитум -> разъём J1'),(223,'Горшок 2 / S-02','Традесканция -> разъём J2')]:
    box(32,y,217,62);text(45,y+24,title,13,True);text(45,y+44,sub,10)
box(32,335,217,88,'#F8EFE6');text(45,360,'Горшок 3 / S-03',13,True)
note(45,380,['Кактус: заменяет J1 или J2.','Вне активной пары не измеряется.'],10)
line(142,335,142,328,MUTED,1,dash=True);text(40,320,'Сначала OFF и смена в сайте',10,color=MUTED)
box(322,130,215,381,'#E3EEDF');text(344,158,'ESP32-WROOM',17,True)
text(344,178,'USB питает плату',11)
rows=[(204,'GPIO34 / ADC1','J1, через делитель'),(254,'GPIO35 / ADC1','J2, через делитель'),(304,'GPIO21 / GPIO22','SDA / SCL'),(354,'GPIO33 / GPIO32','уровень / SW1.B'),(404,'GPIO26 / GPIO27','драйверы Q1 / Q2'),(454,'3V3 / GND','питание датчиков')]
for y,a,b in rows:text(340,y,a,12,True);text(340,y+17,b,10)
label_wire(249,174,285,174);line(285,174,285,204,BLUE,1.8);line(285,204,322,204,BLUE,1.8)
label_wire(249,254,322,254)
box(600,130,209,65);text(614,152,'ПК + сервер Folium',13,True);text(614,173,'Wi-Fi 2,4 GHz / LAN :4174',10)
line(537,155,600,155,GREEN,1.5,dash=True)
box(600,222,209,80);text(614,246,'I2C, питание 3,3 V',13,True)
note(614,267,['SHT31: 0x44 / воздух','BH1750: 0x23 / свет'],10)
line(537,304,568,304,BLUE,1.8);line(568,304,568,265,BLUE,1.8);line(568,265,600,265,BLUE,1.8)
box(600,330,209,54);text(614,352,'Поплавок + SW1.B',12,True);text(614,370,'Сухие контакты на GND',10)
line(537,354,600,354,BLUE,1.8)
box(600,406,209,75,'#F8EFE6');text(614,429,'2 MOSFET + 2 помпы',12,True)
note(614,449,['Питание отдельным БП 5 V','Подробности: лист 2'],10)
line(537,404,570,404,BLUE,1.8);line(570,404,570,437,BLUE,1.8);line(570,437,600,437,BLUE,1.8)
note(32,458,['GND у ESP32 и блока помп общий.','+5 V блока помп не идёт на ESP32.','Сигналы и питание датчиков - 3,3 V.'],10)
text(32,539,'Схема соединений и прошивка рассчитаны на классический ESP32; C3/S3 требуют другой карты выводов.',10,True)
c.showPage()

# 2: motor supply and two independently drawn low-side stages.
header(2,'Питание и два насосных канала','Насосы DC 5 V. AO3400A на монтажной плате; G / D / S проверить по паспорту и маркировке.')
box(32,125,128,47);text(44,147,'БП 5 V / 3 A',12,True);text(44,163,'изолированный',9)
line(160,144,198,144,RED,2);box(198,133,45,22,'#FFF6E9');text(208,148,'F1',11,True)
line(243,144,287,144,RED,2);dot(287,144,RED);dot(327,144,RED);line(287,144,320,132,RED,2)
text(274,123,'SW1.A',11,True);line(327,144,680,144,RED,2)
text(426,132,'+5_PUMP (после выключателя)',11,True,RED)
line(680,144,680,176,RED,2);line(236,176,780,176,RED,2)
cap_v(780,176,'');text(726,193,'470 uF +',9);text(742,210,'10 V',9);ground(780,216)
text(37,185,'F1: по пуску и проводам.',9)
text(37,199,'T1,5 A - после проверки.',9)

def driver(x,index,gpio):
    # one cell fits in 368 pt; y positions shared across the two stages
    text(x+8,220,f'КАНАЛ {index} / GPIO{gpio}',13,True,GREEN)
    px=x+204;dx=x+310;gx=x+112
    line(px,176,px,249,RED,1.8);dot(px,176,RED)
    c.setStrokeColor(HexColor(INK));c.setFillColor(HexColor('#FFFFFF'));c.circle(px,H-274,25,stroke=1,fill=1)
    text(px-10,279,f'M{index}',12,True);text(px-40,242,'+',12,True,RED)
    text(px-40,314,'-',12,True);line(px,299,px,342,INK,1.8)
    # Flyback diode: cathode upper bar, anode below. Same nets as motor terminals.
    line(px,235,dx,235,RED,1.5);dot(px,235,RED);line(dx,235,dx,258,RED,1.5)
    line(dx-10,258,dx+10,258,INK,1.8)
    p=c.beginPath();p.moveTo(dx,H-260);p.lineTo(dx-9,H-279);p.lineTo(dx+9,H-279);p.close()
    c.setFillColor(HexColor('#FFFFFF'));c.drawPath(p,stroke=1,fill=1)
    line(dx,279,dx,328);line(dx,328,px,328);dot(px,328)
    text(dx+14,254,'K',10,True);text(dx+14,287,'A',10,True)
    text(dx+14,311,f'D{index} SS34',9)
    # Electrical block exposes all transistor terminals; not a physical package outline.
    box(px-38,342,76,85,'#E6EEE2');text(px-26,378,f'Q{index}',14,True);text(px-31,396,'AO3400A',9)
    text(px+5,356,'D',10,True);text(px+5,420,'S',10,True);text(px-31,367,'G',10,True)
    line(x+8,367,x+30,367,BLUE,1.6);text(x+6,349,f'GPIO{gpio}',10,True,BLUE)
    res_h(x+30,367,'220 ohm');line(x+84,367,px-38,367,BLUE,1.6);dot(gx,367,BLUE)
    line(gx,367,gx,389);res_v(gx,389,'47 kohm');line(gx,443,gx,456);ground(gx,456)
    line(px,427,px,456);ground(px,456)
    text(x+8,487,'100 nF прямо между контактами мотора.',10)
    text(x+8,504,'D: минус мотора. S: силовой GND.',10)

driver(32,1,26);driver(429,2,27)
text(32,538,'Общий GND: минус БП, Source Q1/Q2 и GND ESP32. Между +5_PUMP и GND также поставить 100 nF.',10,True)
c.showPage()

# 3: probes, I2C and fail-open contacts.
header(3,'Измерительные цепи и разрешение','Контакты не коммутируют ток помп. SW1.B электрически изолирован от силового SW1.A на листе 2.')
box(32,127,452,252);text(48,151,'Почвенная проба: повторить для J1 и J2',14,True)
text(48,177,'VCC -> 3V3     GND -> GND     OUT -> цепь ниже',11)
text(48,216,'OUT',11,True);line(88,211,112,211,BLUE);res_h(112,211,'10 kohm, 1%')
line(166,211,420,211,BLUE,1.8);dot(237,211,BLUE);dot(330,211,BLUE)
text(340,199,'GPIO34 / 35',11,True,BLUE)
res_v(237,211,'20 kohm, 1%');ground(237,265)
cap_v(330,235,'100 nF');line(330,211,330,235);ground(330,275)
note(48,328,['3,3 V на OUT -> около 2,2 V на ADC.','Отключённая проба: нижний резистор тянет ADC к GND.','Калибровать с делителем, кабелем и выбранной глубиной.'],10)
box(32,394,452,149);text(48,419,'Общая шина I2C / 100 kHz',14,True)
note(48,443,['GPIO21 -> SDA SHT31 и SDA BH1750','GPIO22 -> SCL SHT31 и SCL BH1750','VCC обоих модулей -> 3V3; GND -> GND','При отсутствии подтяжек: SDA и SCL по 4,7 kΩ к 3V3.','ADDR к GND: SHT31 = 0x44, BH1750 = 0x23.'],10)

def contact(y,gpio,name,caption):
    text(519,y,name,13,True)
    text(554,y+29,'3V3',10,True,GREEN);res_v(573,y+35,'10 kohm')
    line(573,y+89,573,y+110);dot(573,y+110,BLUE)
    line(573,y+110,760,y+110,BLUE,1.8);text(644,y+101,f'GPIO{gpio}',12,True,BLUE)
    line(573,y+110,573,y+128);dot(573,y+128);dot(573,y+157)
    line(573,y+128,587,y+151);line(573,y+157,573,y+165);ground(573,y+165)
    text(600,y+147,caption,10)

contact(145,33,'Уровень воды / поплавок','замкнут = вода есть')
contact(347,32,'SW1.B / разрешение RUN','замкнут = RUN')
text(519,539,'Обрыв провода = запрет; 5 V сюда не подавать.',10,True,RED)
c.showPage()

# 4: staged commissioning, preserving honest status of validation.
header(4,'Порядок первого включения','Все водные испытания сначала в мерную ёмкость. Трубки закрепить, электронику защитить от брызг.')
steps=[
 ('01 / Без питания','Прозвонить GND, диоды, G/D/S и два изолированных полюса DPST. SW1 OFF.'),
 ('02 / Только USB','Прошить monitor. Насосы программно отключены. Проверить ADC и контакты.'),
 ('03 / Датчики + сервер','Заполнить secrets.h; домашняя Wi-Fi 2,4 GHz. Проверить реальные поля и обрыв пробы.'),
 ('04 / Измерить расход','Прошить pump-test. Вода + OFF -> RUN. Serial: pulse 1 1000; затем второй канал.'),
 ('05 / Калибровка','Записать dry/wet ADC для 3 проб, измеренные мл/с для 2 помп. Примеры не считать данными.'),
 ('06 / Онлайн-полив','Прошить irrigation. Свежие данные, лимиты, разрешение сайта и RUN. Одна малая доза.'),
]
for i,(a,b) in enumerate(steps):
    y=129+i*47;box(32,y,777,40);text(44,y+16,a,11,True,GREEN);text(44,y+32,b,10)
text(32,437,'Затем проверить отказы',14,True)
note(32,458,['SW1 OFF, пустой бак, обрыв пробы, потеря Wi-Fi/сервера, перезапуск во время полива.','Выход должен отключаться; восстановление связи/воды не должно повторять старую дозу.','Неизвестный результат: физически проверить насосы, оставить OFF, подтвердить проверку в сайте.'],11)
text(32,520,'Полная инструкция, таблица деталей, источники и журнал испытаний: docs/hardware-assembly.md',10,True)
text(32,540,'Эта схема подготовлена по документации компонентов. Работоспособность собранного стенда ещё не проверена.',10,color=MUTED)
c.save()
print(OUT)
