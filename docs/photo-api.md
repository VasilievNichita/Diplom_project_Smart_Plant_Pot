# Фотоосмотры: серверная часть

Этот этап добавляет хранение ручной разметки и экспорт выбранных фотографий. Модель не обучалась и не вызывается; диагнозы, точность распознавания и рекомендации по лечению не вычисляются. Интерфейс разметки выпускается отдельным этапом. Существующая загрузка и просмотр фото сохраняют совместимость.

## API

Эти маршруты доступны только через локальный административный сервер. Порт устройств их не предоставляет. Для изменяющих запросов обязательны те же проверки Host/Origin, `Content-Type: application/json` и `X-Folium-Client: web`, что и для [остального API](api.md).

| Метод и путь | Результат |
|---|---|
| `GET /api/photos?mode=real` | Фото выбранного режима с полем `review`; у старых снимков пустая разметка с `revision: 0` |
| `PUT /api/photos/<id>/review` | Проверка и сохранение разметки; устаревшая версия отклоняется с HTTP 409 |
| `GET /api/photo-dataset` | Манифест выбранных уникальных фотографий и счётчики классов/экземпляров |
| `GET /api/photo-dataset.zip` | Архив `manifest.json` и `images/` с оригинальными изображениями, не больше 100 МиБ |

Пример тела изменения разметки (пример формата, не результат осмотра):

```json
{
  "expectedRevision": 0,
  "quality": "usable",
  "identityConfirmed": true,
  "specimenId": "home-chl-01",
  "source": "own",
  "sourceReference": "",
  "signs": ["unknown"],
  "selected": true
}
```

`quality`: `unchecked`, `usable`, `reject`. `source`: `unknown`, `own`, `permitted`; для `permitted` требуется текст с источником и основанием разрешения. Сервер проверяет заполнение, но не удостоверяет авторские права или правильность человеческой разметки.

`identityConfirmed` подтверждает растение, к которому уже прикреплено фото. Код `specimenId` обозначает **один физический экземпляр**, а не вид, сеанс съёмки или канал насоса. Допустимы 1–64 латинских буквы, цифры, дефисы и подчёркивания. Использовать один и тот же код, включая регистр, во все дни и с любых ракурсов. Для фото из интернета, где личность экземпляра неизвестна, нельзя выдумывать независимые экземпляры ради размера набора; оставить снимок вне отбора до проверки.

`signs` — непустой список из `unknown`, `no_visible_issue`, `yellowing`, `wilting`, `dry_edges`, `spots`, `visible_pest`. `unknown` и `no_visible_issue` нельзя сочетать с другими признаками. «Явных изменений не видно» не подтверждает здоровье, а видимое насекомое само по себе не устанавливает вредителя. Неизвестные признаки допустимы для задачи классификации группы растения; они не становятся отрицательными метками заболевания.

Для `selected: true` обязательны реальный режим, пригодное качество, подтверждённое растение, код экземпляра и подтверждённый источник. Черновую разметку можно сохранить с `selected: false`. Смена версии в другой вкладке даёт `photo_review_conflict`: перечитать фото перед повторной записью. При удалении фото его разметка удаляется по внешнему ключу. Таблица добавляется при следующем запуске сервера; прежние фото не переписываются и автоматически не отбираются. Полная резервная копия SQLite включает разметку.

## Состав учебного набора

В архив входят только явно отобранные фото режима `real`. Точные повторы определяются по SHA-256 исходных байтов и выгружаются один раз. Если одно изображение выбрано с разными растениями, кодами экземпляров или признаками, новый противоречивый отбор отклоняется. Один код экземпляра не может относиться к двум группам растений. Похожие снимки, повторно сжатые файлы, кадрированные копии и ошибочно разные коды одного растения автоматически не распознаются; нужна ручная проверка.

Манифест содержит идентификатор фото, группу растения, экземпляр, SHA-256, формат, относительный путь, источник, признаки и версию ручной разметки. Имена исходных файлов, заметки осмотра, контакты, журнал и ключи устройства в манифест не попадают. **Оригиналы сохраняются без перекодирования и могут содержать EXIF/GPS и личные детали кадра.** Архив — приватный рабочий материал. Держать его в `private/` или `datasets/`, не отправлять в публичный репозиторий. Название архива также исключено из Git. Пустой набор даёт HTTP 409; слишком большой архив — HTTP 413. Для большого набора можно выгружать части, сохраняя общие коды экземпляров и проверяя повторы при объединении.

Разметка нацелена на три согласованные группы: хлорофитум, традесканция и кактус. «Кактус» здесь не видовое определение. Все поля `split` пока равны `null`: обучение, валидация и тест ещё не назначены, метрик точности нет.

При подготовке оценки нельзя случайно распределять соседние фото одного растения между обучением и тестом. Нужно отделять группы физических экземпляров и их производные изображения; это применение принципа проверки на независимых группах из [официальной документации scikit-learn](https://scikit-learn.org/stable/modules/cross_validation.html#cross-validation-iterators-for-grouped-data). Три домашних растения — по одному на класс — подходят для сбора наблюдений стенда, но не дают независимой проверки распознавания новых экземпляров каждого класса. Число снимков или отметка «отобрано» не доказывают достаточность набора.

## Проверка этого этапа

Из `site`: `npm test` с Node.js 24+. Тесты проверяют сохранение после перезапуска, удаление разметки вместе с фото, конфликт версий, условия отбора, дубликаты, приватность манифеста, ZIP/CRC и границу административного API. Используются синтетические изображения; они не являются реальными наблюдениями и не используются для обучения. Фотоосмотры не создают команды полива и не снимают его блокировки.
# Web dataset inspection

The loopback admin API now exposes the existing local Python preparation pipeline. These routes are unavailable on the device-only listener and retain the origin/client-header requirements.

- `GET /api/photo-inspection`: latest job, audit, preview catalogue metadata, saved decisions, revision and stale state.
- `POST /api/photo-inspection` with `{}`: snapshot the currently selected real dataset and start an asynchronous audit; returns 202. An unchanged completed check is reused. Only one worker runs at a time.
- `PUT /api/photo-inspection/:id/review`: save `{expectedRevision, auditId, acknowledged, pairs:[{first,second,decision}]}`. Decisions are `""`, `different_specimens`, `same_specimen` or `uncertain`. Exact pair membership is required; incomplete reviews may be saved but cannot authorize preparation.
- `POST /api/photo-inspection/:id/prepare` with `{expectedRevision}`: prepare immutable specimen-level splits with seed 42 after all checks pass. Returns 202; poll the current-job route. No training or irrigation is triggered.
- `GET /api/photo-inspection/:id/thumb/:photoId`: normalized JPEG preview belonging to that audit. Arbitrary paths and files outside the validated catalogue are not served.

Jobs return `running`, `audited`, `preparing`, `prepared` or `failed`. A change in exported image bytes or review metadata makes the snapshot stale; stale saves/preparation return 409. Concurrent review saves require the current revision. Restarted workers become failed rather than being silently resumed. Python runs without a shell, using server-owned paths, with a two-minute deadline. The browser cannot provide executable paths or command arguments.

SQLite stores job metadata and human decisions. Private ZIP snapshots, thumbnails and prepared files live beside the DB in `photo-inspections/<job-id>/`. They are not included in SQLite-only backups and are not deleted when an original photo card is removed. Preserve the folder for reproducibility, or recheck the dataset after restoring only the database. The service requires the local `ml/.venv` environment described in `ml/README.md`.
