export const appPage = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Салатовый гараж</title>
  <link rel="stylesheet" href="/app.css">
  <script src="https://telegram.org/js/telegram-web-app.js" defer></script>
  <script src="/app.js" defer></script>
</head>
<body>
  <header class="top"><h1 id="heading">Гараж</h1></header>
  <main id="main">
    <p id="status" class="status" role="status" aria-live="polite"></p>
    <div id="content"></div>
  </main>
  <nav id="dock" aria-label="Навигация по гаражу"></nav>
</body>
</html>`;

export const appStyles = String.raw`
:root {
  color-scheme: dark;
  --background: var(--tg-theme-bg-color, #101612);
  --surface: var(--tg-theme-secondary-bg-color, #1b241d);
  --text: var(--tg-theme-text-color, #edf4e9);
  --hint: var(--tg-theme-hint-color, #adbba9);
  --accent: #b6ef51;
  font: 16px/1.5 system-ui, -apple-system, sans-serif;
  background: var(--background);
  color: var(--text);
}
* { box-sizing: border-box; }
body { margin: 0; }
.top, #main, #dock {
  width: min(100%, 44rem);
  margin: 0 auto;
  padding-inline: max(1rem, env(safe-area-inset-left));
}
.top { padding-top: max(.9rem, env(safe-area-inset-top)); padding-bottom: .75rem; }
h1, h2, p { margin: 0; overflow-wrap: anywhere; }
h1 { font-size: 1.75rem; line-height: 1.2; letter-spacing: -.035em; }
h2 { font-size: 1rem; line-height: 1.35; }
#main { padding-bottom: calc(6rem + env(safe-area-inset-bottom)); }
#content, .stack { display: grid; gap: .75rem; }
#dock {
  position: fixed; inset: auto 0 0; z-index: 1;
  background: var(--background);
  padding-top: .65rem; padding-bottom: calc(.65rem + env(safe-area-inset-bottom));
  display: flex; gap: .55rem;
}
#dock:empty, .status:empty { display: none; }
#dock button { flex: 1; }
button, input, textarea, select { font: inherit; }
button {
  min-height: 44px; border: 0; border-radius: .8rem; padding: .6rem .95rem;
  color: var(--text); background: var(--surface); cursor: pointer;
  font-weight: 650;
}
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
button:disabled { opacity: .55; cursor: wait; }
.primary { color: #142000; background: var(--accent); }
.card { background: var(--surface); border-radius: 1rem; padding: .9rem 1rem; }
.record { display: grid; gap: .25rem; text-align: left; width: 100%; font-weight: 500; }
.record:hover { filter: brightness(1.08); }
.record-title { font-weight: 700; }
.muted { color: var(--hint); font-size: .875rem; }
.status { margin: 0 0 .85rem; padding: .7rem 1rem; background: var(--surface); border-radius: .7rem; }
.row { display: flex; flex-wrap: wrap; gap: .55rem; }
.amounts { display: grid; grid-template-columns: 1fr 1fr; gap: .8rem 1rem; margin: 0; }
.amounts dt { color: var(--hint); font-size: .82rem; margin: 0 0 .05rem; }
.amounts dd { margin: 0; font-weight: 700; min-height: 1.5rem; overflow-wrap: anywhere; }
label { display: grid; gap: .3rem; font-size: .875rem; color: var(--hint); }
input, select, textarea {
  width: 100%; min-height: 44px; color: var(--text); background: var(--surface);
  border: 1px solid color-mix(in srgb, var(--hint), transparent 65%);
  border-radius: .7rem; padding: .6rem .75rem; font-size: 16px;
}
textarea { resize: vertical; min-height: 8rem; }
input::placeholder, textarea::placeholder { color: var(--hint); opacity: 1; }
.entry-text { white-space: pre-wrap; }

.calendar-modes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .4rem; }
.calendar-modes button { padding-inline: .25rem; }
.calendar-navigation { display: grid; grid-template-columns: 44px 1fr 44px; gap: .6rem; align-items: center; }
.calendar-navigation h2 { text-align: center; text-transform: capitalize; }
.calendar-modes button, .calendar-navigation button { min-width: 0; }
.calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: .24rem; align-items: stretch; }
.calendar-weekday { color: var(--hint); text-align: center; font-size: .72rem; }
.calendar-day {
  min-height: 44px; min-width: 0; padding: .23rem .12rem;
  display: grid; align-content: center; justify-items: center;
  background: var(--surface); border-radius: .5rem; font-size: .8rem; line-height: 1.15;
}
.expense-day { background: color-mix(in srgb, var(--surface), var(--accent) 16%); }
.calendar-amount { display: block; width: 100%; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .65rem; margin-top: .15rem; }
.calendar-today { outline: 1px solid var(--accent); outline-offset: -1px; }
.calendar-months { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .55rem; }
.calendar-months .record-title { text-transform: capitalize; }
@media (max-width: 340px) {
  .top, #main, #dock { padding-inline: .65rem; }
  h1 { font-size: 1.5rem; }
}
`;
