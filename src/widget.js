export const widgetHtml = '<!doctype html><html lang="ru"><meta charset="utf-8"><style>' +
  'body{margin:0;padding:12px;color:var(--tg-theme-text-color,#181a19);background:var(--tg-theme-bg-color,#fff);font:14px sans-serif;overflow-wrap:anywhere}' +
  'main{border-left:4px solid #96c832;padding:2px 0 2px 10px}h2{font-size:17px;margin:0 0 8px}p{margin:4px 0}table{margin-top:8px;border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--tg-theme-secondary-bg-color,#ddd);padding:4px;text-align:left}</style>' +
  '<main><h2></h2><section></section><table></table></main><script>' +
  'const W=window.TelegramWidget;const h=document.querySelector("h2"),s=document.querySelector("section"),t=document.querySelector("table");' +
  'function node(tag,text){const e=document.createElement(tag);e.textContent=text;return e}' +
  'function draw(){const d=JSON.parse(W.chatData||"{}");h.textContent=d.t||"";s.replaceChildren(...(d.l||[]).map(x=>node("p",x)));' +
  't.replaceChildren(...(d.r||[]).map((row,i)=>{const tr=document.createElement("tr");tr.append(...row.map(x=>node(i?"td":"th",x)));return tr}));}' +
  'W.onEvent("chatDataChanged",draw);draw();</script></html>';

const encoder = new TextEncoder();

export function widgetState(card) {
  const data = { t: card.title, l: card.lines, r: card.table };
  const json = JSON.stringify(data);
  if (encoder.encode(json).length <= 1024) return { chat_data: json, caption: card.details.join("\n") };
  return {
    chat_data: JSON.stringify({ t: card.title, l: [], r: card.table }),
    caption: [...card.lines, ...card.details].join("\n").slice(0, 1024),
  };
}
