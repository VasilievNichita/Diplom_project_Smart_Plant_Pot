const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function moistureChart(series, {since, until, locale, label, demo = false}) {
  if (!Number.isFinite(since) || !Number.isFinite(until) || until <= since) throw new RangeError('Invalid chart time window');
  const colors = ['#537b56', '#9876a0'];
  const x = time => 34 + 432 * (time - since) / (until - since), y = value => 139 - value * 1.2;
  const valid = series.map(s => ({...s, points: s.points.filter(p => Number.isFinite(p.time) && Number.isFinite(p.value) && p.value >= 0 && p.value <= 100 && p.time >= since && p.time <= until).sort((a,b) => a.time-b.time)}));
  const points = valid.flatMap((s,i) => s.points.map(p => ({...p, name:s.name, color:colors[i%2], x:x(p.time), y:y(p.value)}))).sort((a,b)=>a.time-b.time);
  const format = n => new Intl.DateTimeFormat(locale, {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(n);
  return `<div class="moisture-chart" data-points="${escape(JSON.stringify(points))}" data-locale="${locale}"><svg viewBox="0 0 490 172" class="chart" aria-label="${escape(label)}" role="img">${[0,25,50,75,100].map(n => `<line x1="34" x2="466" y1="${y(n)}" y2="${y(n)}" stroke="#e7ebdf" stroke-dasharray="3 5"/><text x="3" y="${y(n)+4}">${n}</text>`).join('')}${valid.map((s,i) => `<path d="${s.points.map((p,j)=>`${j?'L':'M'}${x(p.time)},${y(p.value)}`).join(' ')}" fill="none" stroke="${colors[i%2]}" stroke-width="2.4"/>${s.points.map(p=>`<circle cx="${x(p.time)}" cy="${y(p.value)}" r="2.5" fill="${colors[i%2]}"/>`).join('')}`).join('')}<line class="chart-cursor" x1="34" x2="34" y1="15" y2="140" stroke="#667c66" stroke-dasharray="3 3" visibility="hidden"/><circle class="chart-marker" r="5" fill="#315e48" stroke="white" stroke-width="2" visibility="hidden"/><text x="34" y="162">${escape(format(since))}</text><text x="466" y="162" text-anchor="end">${escape(format(until))}</text></svg><output class="chart-tooltip" hidden></output><input class="chart-scrubber" type="range" min="0" max="${Math.max(0,points.length-1)}" value="0" aria-label="${escape(label)}" ${points.length?'':'disabled'}><div class="chart-legend">${valid.map((s,i)=>`<span><i style="background:${colors[i%2]}"></i>${escape(s.name)}</span>`).join('')}${demo?'<span>DEMO</span>':''}</div></div>`;
}
export function bindCharts(root = document) {
  for (const host of root.querySelectorAll('.moisture-chart')) {
    const points = JSON.parse(host.dataset.points), svg = host.querySelector('svg'), tip = host.querySelector('output'), range = host.querySelector('input');
    const show = index => {
      const p = points[index]; if (!p) return;
      tip.textContent = `${new Intl.DateTimeFormat(host.dataset.locale,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(p.time)} · ${p.name}: ${p.value.toFixed(1)}%`;
      tip.hidden = false; range.value = index; range.setAttribute('aria-valuetext', tip.textContent);
      const cursor = host.querySelector('.chart-cursor'), marker = host.querySelector('.chart-marker');
      cursor.setAttribute('x1',p.x);cursor.setAttribute('x2',p.x);cursor.setAttribute('visibility','visible');
      marker.setAttribute('cx',p.x);marker.setAttribute('cy',p.y);marker.setAttribute('fill',p.color);marker.setAttribute('visibility','visible');
    };
    svg.addEventListener('pointermove',event=>{
      const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
      const pos=point.matrixTransform(svg.getScreenCTM().inverse());
      let best=0,distance=Infinity;points.forEach((p,i)=>{const d=Math.abs(p.x-pos.x)+Math.abs(p.y-pos.y)*.15;if(d<distance){best=i;distance=d;}});show(best);
    });
    range.addEventListener('input',()=>show(Number(range.value)));range.addEventListener('focus',()=>show(Number(range.value)));
  }
}
