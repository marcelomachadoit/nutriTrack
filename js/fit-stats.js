// FitTrack — estatísticas: evolução por exercício, volume semanal, séries por grupo muscular,
// recordes e treinos recentes. Tudo é calculado no aparelho a partir de exercise_logs.
// Os gráficos seguem o do peso (ui.js): SVG na largura real, uma série só, mira + dica no
// toque/mouse e uma tabela com os mesmos números para quem não lê o gráfico.

const STATS_RANGES = { '28': 28, '84': 84, all: null };
const STATS_MAX_WEEKS = 52;
const STATS_HISTORY_DAYS = 8;

let statsLogs = [];
let statsRecordIds = new Set();
let statsRange = '84';
let statsExerciseId = null;
let statsMetric = 'weight';
let volumeMetric = 'sets';
let statsLoaded = false;

async function loadFitStats() {
  statsLogs = await getAllExerciseLogs();
  statsRecordIds = personalRecordIds(statsLogs);
  statsLoaded = true;
  renderFitStats();
}

function statsRangeStart() {
  const dias = STATS_RANGES[statsRange];
  return dias ? addDaysToKey(todayKey(), -(dias - 1)) : null;
}

function logsInStatsRange(logs = statsLogs) {
  const inicio = statsRangeStart();
  return inicio ? logs.filter((log) => log.date >= inicio) : logs;
}

function formatKgTotal(kg) {
  return `${formatNumber(Math.round(kg))} kg`;
}

function setPressed(selector, attribute, value) {
  document.querySelectorAll(selector).forEach((botao) => {
    const ativo = botao.dataset[attribute] === value;
    botao.classList.toggle('selected', ativo);
    botao.setAttribute('aria-pressed', String(ativo));
  });
}

function appendStatTiles(container, tiles) {
  container.replaceChildren();
  tiles.forEach(([rotulo, valor]) => {
    const item = document.createElement('div');
    const nome = document.createElement('span');
    nome.textContent = rotulo;
    const numero = document.createElement('strong');
    numero.textContent = valor;
    item.append(nome, numero);
    container.append(item);
  });
}

function emptyState(texto) {
  const vazio = document.createElement('p');
  vazio.className = 'empty-state';
  vazio.textContent = texto;
  return vazio;
}

function renderFitStats() {
  setPressed('[data-stats-range]', 'statsRange', statsRange);
  setPressed('[data-volume-metric]', 'volumeMetric', volumeMetric);
  const periodo = logsInStatsRange();
  renderStatsSummary(periodo);
  renderStatsExerciseSelect();
  renderLiftProgress();
  renderWeeklyVolume();
  renderMuscleSets(periodo);
  renderRecords();
  renderHistory();
}

/* Resumo do período -------------------------------------------------------- */

function renderStatsSummary(periodo) {
  const dias = new Set(periodo.map((log) => log.date));
  appendStatTiles(document.querySelector('#fit-summary'), [
    [t('Treinos'), String(dias.size)],
    [t('Séries'), formatNumber(periodo.reduce((soma, log) => soma + log.sets, 0))],
    [t('Carga total'), formatKgTotal(periodo.reduce((soma, log) => soma + logVolume(log), 0))],
    [t('Recordes'), String(periodo.filter((log) => statsRecordIds.has(log.id)).length)],
  ]);
}

/* Evolução por exercício ------------------------------------------------------ */

// Exercícios com algum registro, do treinado mais recentemente para o mais antigo.
function loggedExercises() {
  const ultimo = new Map();
  statsLogs.forEach((log) => ultimo.set(String(log.exercise_id), log.date));
  return [...ultimo.entries()]
    .map(([id, data]) => ({ exercise: findExercise(id), data }))
    .filter((item) => item.exercise)
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : exerciseName(a.exercise).localeCompare(exerciseName(b.exercise), appLocale())));
}

function renderStatsExerciseSelect() {
  const select = document.querySelector('#stats-exercise');
  const lista = loggedExercises();
  select.replaceChildren();
  lista.forEach(({ exercise }) => {
    const option = document.createElement('option');
    option.value = String(exercise.id);
    option.textContent = exerciseName(exercise);
    select.append(option);
  });
  select.disabled = !lista.length;
  if (!lista.some(({ exercise }) => String(exercise.id) === String(statsExerciseId))) {
    statsExerciseId = lista.length ? String(lista[0].exercise.id) : null;
  }
  if (statsExerciseId) select.value = statsExerciseId;
}

// Medidas do gráfico. Exercício feito só com o peso do corpo não tem carga: mostra repetições.
const LIFT_METRICS = {
  weight: { label: 'Carga', value: (log) => log.weight_kg, format: (v) => `${formatNumber(v)} kg` },
  e1rm: { label: '1RM estimado', value: (log) => estimateOneRepMax(log), format: (v) => `${formatNumber(Math.round(v * 10) / 10)} kg` },
  volume: { label: 'Volume', value: (log) => logVolume(log), format: (v) => formatKgTotal(v) },
  reps: { label: 'Repetições', value: (log) => log.reps, format: (v) => t('{0} reps', formatNumber(v)) },
};

function renderLiftProgress() {
  const grafico = document.querySelector('#lift-chart');
  const nota = document.querySelector('#lift-note');
  const corpo = document.querySelector('#lift-table-body');
  const tiles = document.querySelector('#lift-stats');
  const seletorMedida = document.querySelector('#stats-metric');
  grafico.replaceChildren();
  corpo.replaceChildren();
  nota.textContent = '';

  const todos = statsLogs.filter((log) => String(log.exercise_id) === String(statsExerciseId));
  if (!todos.length) {
    tiles.replaceChildren();
    seletorMedida.hidden = true;
    grafico.append(emptyState(statsLoaded
      ? t('Registre cargas na aba Treino para ver a evolução de cada exercício.')
      : t('Carregando estatísticas...')));
    return;
  }

  const pesoCorporal = todos.every((log) => !log.weight_kg);
  seletorMedida.hidden = pesoCorporal;
  const chave = pesoCorporal ? 'reps' : statsMetric;
  const medida = LIFT_METRICS[chave];
  setPressed('[data-stats-metric]', 'statsMetric', statsMetric);

  const periodo = logsInStatsRange(todos);
  const valores = periodo.map((log) => medida.value(log));
  const melhorPeriodo = valores.length ? Math.max(...valores) : null;
  const variacao = valores.length > 1 ? valores[valores.length - 1] - valores[0] : null;
  const ultimo = todos[todos.length - 1];
  appendStatTiles(tiles, [
    [t('Último registro'), medida.format(medida.value(ultimo))],
    [t('Melhor no período'), melhorPeriodo === null ? '—' : medida.format(melhorPeriodo)],
    [t('Variação no período'), variacao === null ? '—' : `${variacao > 0 ? '+' : variacao < 0 ? '−' : ''}${medida.format(Math.abs(variacao))}`],
  ]);

  if (!periodo.length) {
    grafico.append(emptyState(t('Nenhum registro deste exercício no período. Escolha um período maior.')));
  } else {
    const nome = exerciseName(findExercise(statsExerciseId));
    renderLineChart(grafico, periodo.map((log) => ({ date: log.date, value: medida.value(log), log })), {
      format: medida.format,
      ariaLabel: t('{0} de {1}: de {2} para {3}.', t(medida.label), nome, medida.format(valores[0]), medida.format(valores[valores.length - 1])),
      details: (ponto) => [t('{0} séries × {1} com {2}', ponto.log.sets, ponto.log.reps, formatLoad(ponto.log.weight_kg))],
      highlight: (ponto) => statsRecordIds.has(ponto.log.id),
    });
  }
  if (pesoCorporal) nota.textContent = t('Exercício feito com o peso do corpo: o gráfico mostra as repetições.');
  else if (chave === 'e1rm') nota.textContent = t('1RM estimado pela fórmula de Epley a partir da carga e das repetições. É uma referência, não um teste de carga máxima.');
  else if (chave === 'volume') nota.textContent = t('Volume = carga × séries × repetições do dia.');
  else nota.textContent = t('Pontos com anel são recordes de carga.');

  [...todos].reverse().forEach((log) => {
    const linha = document.createElement('tr');
    const data = document.createElement('th');
    data.scope = 'row';
    data.textContent = formatLongDay(log.date);
    linha.append(data);
    [formatLoad(log.weight_kg), `${log.sets} × ${log.reps}`, log.weight_kg ? `${formatNumber(Math.round(estimateOneRepMax(log) * 10) / 10)} kg` : '—', formatKgTotal(logVolume(log))]
      .forEach((valor) => {
        const celula = document.createElement('td');
        celula.textContent = valor;
        linha.append(celula);
      });
    corpo.append(linha);
  });
}

// Linha de uma série ao longo do tempo. Mesma geometria do gráfico de peso: escala de tempo
// real no eixo x, grade "redonda" no y e dica no ponto mais próximo do cursor ou do dedo.
function renderLineChart(caixa, pontos, opcoes) {
  const largura = Math.max(280, Math.round(caixa.clientWidth || 600));
  const altura = 220;
  const m = { top: 16, right: 16, bottom: 28, left: 52 };
  const plotW = largura - m.left - m.right;
  const plotH = altura - m.top - m.bottom;

  const valores = pontos.map((p) => p.value);
  const folga = Math.max(Math.max(...valores) * 0.04, (Math.max(...valores) - Math.min(...valores)) * 0.15, 1);
  let min = Math.max(0, Math.min(...valores) - folga);
  let max = Math.max(...valores) + folga;
  const passo = niceStep((max - min) / 3);
  min = Math.max(0, Math.floor(min / passo) * passo);
  max = Math.ceil(max / passo) * passo;

  const t0 = parseDateKey(pontos[0].date).getTime();
  const t1 = parseDateKey(pontos[pontos.length - 1].date).getTime();
  const xDe = (key) => (t1 === t0 ? m.left + (plotW / 2) : m.left + (((parseDateKey(key).getTime() - t0) / (t1 - t0)) * plotW));
  const yDe = (v) => m.top + ((1 - ((v - min) / (max - min))) * plotH);

  const svg = svgEl('svg', { viewBox: `0 0 ${largura} ${altura}`, width: '100%', height: altura, role: 'img', 'aria-label': opcoes.ariaLabel });
  for (let v = min; v <= max + (passo / 2); v += passo) {
    const y = yDe(v);
    svg.append(svgEl('line', { x1: m.left, x2: largura - m.right, y1: y, y2: y, class: 'weight-grid' }));
    const rotulo = svgEl('text', { x: m.left - 8, y: y + 4, class: 'weight-axis', 'text-anchor': 'end' });
    rotulo.textContent = new Intl.NumberFormat(appLocale(), { maximumFractionDigits: 1, notation: v >= 10000 ? 'compact' : 'standard' }).format(v);
    svg.append(rotulo);
  }

  const xy = pontos.map((p) => [xDe(p.date), yDe(p.value)]);
  if (xy.length > 1) svg.append(svgEl('path', { d: xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' '), class: 'weight-line' }));
  xy.forEach(([x, y], i) => {
    const recorde = opcoes.highlight && opcoes.highlight(pontos[i]);
    svg.append(svgEl('circle', { cx: x, cy: y, r: recorde ? 6 : 4, class: `weight-point${recorde ? ' is-record' : ''}` }));
  });

  const marcas = pontos.length > 2 ? [0, Math.floor((pontos.length - 1) / 2), pontos.length - 1] : [...new Set([0, pontos.length - 1])];
  marcas.forEach((i) => {
    const anchor = i === 0 && pontos.length > 1 ? 'start' : i === pontos.length - 1 && pontos.length > 1 ? 'end' : 'middle';
    const texto = svgEl('text', { x: xy[i][0], y: altura - 8, class: 'weight-axis', 'text-anchor': anchor });
    texto.textContent = formatDayMonth(pontos[i].date);
    svg.append(texto);
  });

  const cruz = svgEl('line', { y1: m.top, y2: altura - m.bottom, class: 'weight-crosshair', visibility: 'hidden' });
  const destaque = svgEl('circle', { r: 6, class: 'weight-point is-active', visibility: 'hidden' });
  const alvoToque = svgEl('rect', { x: m.left - 12, y: 0, width: plotW + 24, height: altura, class: 'weight-hit' });
  svg.append(cruz, destaque, alvoToque);

  const dica = document.createElement('div');
  dica.className = 'weight-tooltip';
  dica.hidden = true;
  const mostrar = (evento) => {
    const caixaSvg = svg.getBoundingClientRect();
    const xCursor = ((evento.clientX - caixaSvg.left) / caixaSvg.width) * largura;
    let indice = 0;
    xy.forEach(([x], i) => { if (Math.abs(x - xCursor) < Math.abs(xy[indice][0] - xCursor)) indice = i; });
    const [x, y] = xy[indice];
    const ponto = pontos[indice];
    cruz.setAttribute('x1', x);
    cruz.setAttribute('x2', x);
    cruz.setAttribute('visibility', 'visible');
    destaque.setAttribute('cx', x);
    destaque.setAttribute('cy', y);
    destaque.setAttribute('visibility', 'visible');
    dica.replaceChildren();
    const data = document.createElement('span');
    data.textContent = formatLongDay(ponto.date);
    const valor = document.createElement('strong');
    valor.textContent = opcoes.format(ponto.value);
    dica.append(data, valor);
    (opcoes.details ? opcoes.details(ponto) : []).forEach((texto) => {
      const linha = document.createElement('span');
      linha.textContent = texto;
      dica.append(linha);
    });
    if (opcoes.highlight && opcoes.highlight(ponto)) {
      const selo = document.createElement('span');
      selo.className = 'tooltip-record';
      selo.textContent = t('Recorde de carga');
      dica.append(selo);
    }
    dica.hidden = false;
    const proporcao = x / largura;
    dica.style.left = `${proporcao * 100}%`;
    dica.style.transform = `translateX(${proporcao > 0.7 ? '-100%' : proporcao < 0.3 ? '0' : '-50%'})`;
  };
  const esconder = () => {
    cruz.setAttribute('visibility', 'hidden');
    destaque.setAttribute('visibility', 'hidden');
    dica.hidden = true;
  };
  alvoToque.addEventListener('pointermove', mostrar);
  alvoToque.addEventListener('pointerdown', mostrar);
  alvoToque.addEventListener('pointerleave', esconder);
  caixa.append(svg, dica);
}

/* Volume semanal --------------------------------------------------------------- */

// Semanas de segunda a domingo, do início do período até a semana atual. Semana sem
// treino entra zerada: a falta de treino também é informação.
function weeklyTotals() {
  const atual = weekStartKey(todayKey());
  const inicioPeriodo = statsRangeStart() || (statsLogs.length ? statsLogs[0].date : todayKey());
  let inicio = weekStartKey(inicioPeriodo);
  const limite = addDaysToKey(atual, -7 * (STATS_MAX_WEEKS - 1));
  if (inicio < limite) inicio = limite;
  const semanas = [];
  for (let semana = inicio; semana <= atual; semana = addDaysToKey(semana, 7)) {
    semanas.push({ start: semana, sets: 0, volume: 0, days: new Set() });
  }
  const porInicio = new Map(semanas.map((s) => [s.start, s]));
  statsLogs.forEach((log) => {
    const semana = porInicio.get(weekStartKey(log.date));
    if (!semana) return;
    semana.sets += log.sets;
    semana.volume += logVolume(log);
    semana.days.add(log.date);
  });
  return semanas;
}

// Caminho de barra com os cantos de cima arredondados e a base reta, presa no eixo.
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
}

function renderWeeklyVolume() {
  const caixa = document.querySelector('#volume-chart');
  const corpo = document.querySelector('#volume-table-body');
  caixa.replaceChildren();
  corpo.replaceChildren();
  if (!statsLogs.length) {
    caixa.append(emptyState(statsLoaded ? t('Ainda não há treinos registrados.') : t('Carregando estatísticas...')));
    return;
  }
  const semanas = weeklyTotals();
  const chave = volumeMetric;
  const formatar = chave === 'sets' ? (v) => t('{0} séries', formatNumber(v)) : formatKgTotal;
  const atual = weekStartKey(todayKey());

  const largura = Math.max(280, Math.round(caixa.clientWidth || 600));
  const altura = 210;
  const m = { top: 14, right: 8, bottom: 28, left: 52 };
  const plotW = largura - m.left - m.right;
  const plotH = altura - m.top - m.bottom;
  const maior = Math.max(...semanas.map((s) => s[chave]), 1);
  const passo = niceStep(maior / 3);
  const max = Math.ceil((maior * 1.05) / passo) * passo;
  const banda = plotW / semanas.length;
  const larguraBarra = Math.max(3, Math.min(34, banda * 0.66));
  const yDe = (v) => m.top + ((1 - (v / max)) * plotH);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${largura} ${altura}`, width: '100%', height: altura, role: 'img',
    'aria-label': t('{0} por semana, {1} semanas. Esta semana: {2}.', chave === 'sets' ? t('Séries') : t('Carga total'), semanas.length, formatar(semanas[semanas.length - 1][chave])),
  });
  for (let v = 0; v <= max + (passo / 2); v += passo) {
    const y = yDe(v);
    svg.append(svgEl('line', { x1: m.left, x2: largura - m.right, y1: y, y2: y, class: v === 0 ? 'bar-baseline' : 'weight-grid' }));
    const rotulo = svgEl('text', { x: m.left - 8, y: y + 4, class: 'weight-axis', 'text-anchor': 'end' });
    rotulo.textContent = new Intl.NumberFormat(appLocale(), { maximumFractionDigits: 1, notation: v >= 10000 ? 'compact' : 'standard' }).format(v);
    svg.append(rotulo);
  }

  // Rótulos de semana espaçados para não colidirem: no máximo seis no eixo.
  const intervalo = Math.ceil(semanas.length / 6);
  const dica = document.createElement('div');
  dica.className = 'weight-tooltip';
  dica.hidden = true;
  const barras = [];

  semanas.forEach((semana, i) => {
    const valor = semana[chave];
    const x = m.left + (banda * i) + ((banda - larguraBarra) / 2);
    const y = yDe(valor);
    const barra = svgEl('path', { d: barPath(x, y, larguraBarra, Math.max(0, m.top + plotH - y)), class: `bar${semana.start === atual ? ' is-current' : ''}` });
    svg.append(barra);
    barras.push(barra);
    if ((semanas.length - 1 - i) % intervalo === 0) {
      const texto = svgEl('text', { x: x + (larguraBarra / 2), y: altura - 8, class: 'weight-axis', 'text-anchor': 'middle' });
      texto.textContent = semana.start === atual ? t('Esta') : formatDayMonth(semana.start);
      svg.append(texto);
    }
    // Alvo de toque da coluna inteira, maior que a barra (barra de valor zero também responde).
    const alvo = svgEl('rect', { x: m.left + (banda * i), y: m.top, width: banda, height: plotH, class: 'bar-hit' });
    const mostrar = () => {
      barras.forEach((b, j) => b.classList.toggle('is-dim', j !== i));
      dica.replaceChildren();
      const titulo = document.createElement('span');
      titulo.textContent = semana.start === atual ? t('Esta semana') : t('Semana de {0}', formatDayMonth(semana.start));
      const numero = document.createElement('strong');
      numero.textContent = formatar(valor);
      const extra = document.createElement('span');
      extra.textContent = semana.days.size === 1 ? t('1 treino') : t('{0} treinos', semana.days.size);
      dica.append(titulo, numero, extra);
      dica.hidden = false;
      const proporcao = (x + (larguraBarra / 2)) / largura;
      dica.style.left = `${proporcao * 100}%`;
      dica.style.transform = `translateX(${proporcao > 0.7 ? '-100%' : proporcao < 0.3 ? '0' : '-50%'})`;
    };
    alvo.addEventListener('pointerenter', mostrar);
    alvo.addEventListener('pointerdown', mostrar);
    svg.append(alvo);
  });
  svg.addEventListener('pointerleave', () => {
    barras.forEach((b) => b.classList.remove('is-dim'));
    dica.hidden = true;
  });
  caixa.append(svg, dica);

  [...semanas].reverse().forEach((semana) => {
    const linha = document.createElement('tr');
    const nome = document.createElement('th');
    nome.scope = 'row';
    nome.textContent = semana.start === atual ? t('Esta semana') : t('Semana de {0}', formatDayMonth(semana.start));
    linha.append(nome);
    [String(semana.days.size), formatNumber(semana.sets), formatKgTotal(semana.volume)].forEach((valor) => {
      const celula = document.createElement('td');
      celula.textContent = valor;
      linha.append(celula);
    });
    corpo.append(linha);
  });
}

/* Séries por grupo muscular ---------------------------------------------------- */

// Lista ordenada com barras na mesma cor: comparar tamanhos é o trabalho, então uma cor só.
function renderMuscleSets(periodo) {
  const caixa = document.querySelector('#muscle-bars');
  caixa.replaceChildren();
  const porGrupo = new Map();
  periodo.forEach((log) => {
    const exercise = findExercise(log.exercise_id);
    if (!exercise) return;
    porGrupo.set(exercise.muscle_group, (porGrupo.get(exercise.muscle_group) || 0) + log.sets);
  });
  const grupos = [...porGrupo.entries()].sort((a, b) => b[1] - a[1]);
  if (!grupos.length) {
    caixa.append(emptyState(statsLoaded ? t('Nenhuma série registrada no período.') : t('Carregando estatísticas...')));
    return;
  }
  const maior = grupos[0][1];
  grupos.forEach(([grupo, series]) => {
    const linha = document.createElement('div');
    linha.className = 'muscle-row';
    const nome = document.createElement('span');
    nome.textContent = muscleLabel(grupo);
    const trilho = document.createElement('span');
    trilho.className = 'muscle-track';
    const barra = document.createElement('i');
    barra.style.width = `${(series / maior) * 100}%`;
    trilho.append(barra);
    const valor = document.createElement('strong');
    valor.textContent = formatNumber(series);
    linha.append(nome, trilho, valor);
    linha.setAttribute('aria-label', t('{0}: {1} séries', muscleLabel(grupo), series));
    caixa.append(linha);
  });
}

/* Recordes ---------------------------------------------------------------------- */

function renderRecords() {
  const corpo = document.querySelector('#records-body');
  corpo.replaceChildren();
  const porExercicio = new Map();
  statsLogs.forEach((log) => {
    const chave = String(log.exercise_id);
    const atual = porExercicio.get(chave);
    // Maior carga; no empate, mais repetições; no empate de novo, a primeira vez que aconteceu.
    if (!atual || log.weight_kg > atual.best.weight_kg || (log.weight_kg === atual.best.weight_kg && log.reps > atual.best.reps)) {
      porExercicio.set(chave, { best: log, count: (atual ? atual.count : 0) + 1 });
    } else {
      atual.count += 1;
    }
  });
  const linhas = [...porExercicio.entries()]
    .map(([id, info]) => ({ exercise: findExercise(id), ...info }))
    .filter((item) => item.exercise)
    .sort((a, b) => (a.best.date < b.best.date ? 1 : a.best.date > b.best.date ? -1 : 0));

  if (!linhas.length) {
    const linha = document.createElement('tr');
    const celula = document.createElement('td');
    celula.colSpan = 4;
    celula.className = 'records-empty';
    celula.textContent = statsLoaded ? t('Seus recordes aparecem aqui depois dos primeiros registros.') : t('Carregando estatísticas...');
    linha.append(celula);
    corpo.append(linha);
    return;
  }

  const recente = addDaysToKey(todayKey(), -6);
  linhas.forEach(({ exercise, best, count }) => {
    const linha = document.createElement('tr');
    const nome = document.createElement('th');
    nome.scope = 'row';
    const titulo = document.createElement('span');
    titulo.className = 'records-name';
    titulo.textContent = exerciseName(exercise);
    nome.append(titulo);
    // "Novo" só quando o recorde é desta semana e superou um registro anterior.
    if (best.date >= recente && count > 1 && statsRecordIds.has(best.id)) {
      const selo = document.createElement('span');
      selo.className = 'own-badge';
      selo.textContent = t('Novo');
      nome.append(selo);
    }
    const sub = document.createElement('small');
    sub.textContent = count === 1 ? t('1 registro') : t('{0} registros', count);
    nome.append(sub);
    const carga = document.createElement('td');
    carga.textContent = best.weight_kg ? `${formatLoad(best.weight_kg)} × ${best.reps}` : t('{0} reps', best.reps);
    const rm = document.createElement('td');
    rm.textContent = best.weight_kg ? `${formatNumber(Math.round(estimateOneRepMax(best) * 10) / 10)} kg` : '—';
    const data = document.createElement('td');
    data.textContent = formatDayMonth(best.date);
    linha.append(nome, carga, rm, data);
    corpo.append(linha);
  });
}

/* Treinos recentes ---------------------------------------------------------------- */

function renderHistory() {
  const lista = document.querySelector('#history-list');
  lista.replaceChildren();
  const porDia = new Map();
  statsLogs.forEach((log) => {
    if (!porDia.has(log.date)) porDia.set(log.date, []);
    porDia.get(log.date).push(log);
  });
  const dias = [...porDia.keys()].sort().reverse().slice(0, STATS_HISTORY_DAYS);
  if (!dias.length) {
    const vazio = document.createElement('li');
    vazio.append(emptyState(statsLoaded ? t('Ainda não há treinos registrados.') : t('Carregando estatísticas...')));
    lista.append(vazio);
    return;
  }
  dias.forEach((dia) => {
    const registros = porDia.get(dia);
    const item = document.createElement('li');
    item.className = 'history-item';
    const data = parseDateKey(dia);
    const selo = document.createElement('span');
    selo.className = 'history-date';
    const numero = document.createElement('b');
    numero.textContent = String(data.getDate());
    const mes = document.createElement('small');
    mes.textContent = data.toLocaleDateString(appLocale(), { month: 'short' }).replace('.', '').toUpperCase();
    selo.append(numero, mes);

    const corpo = document.createElement('div');
    corpo.className = 'history-body';
    const titulo = document.createElement('strong');
    titulo.textContent = weekdayName(data, 'long');
    const resumo = document.createElement('small');
    const series = registros.reduce((soma, log) => soma + log.sets, 0);
    const volume = registros.reduce((soma, log) => soma + logVolume(log), 0);
    const exercicios = registros.length === 1 ? t('1 exercício') : t('{0} exercícios', registros.length);
    resumo.textContent = `${exercicios} · ${t('{0} séries', series)} · ${formatKgTotal(volume)}`;
    const nomes = document.createElement('p');
    nomes.textContent = registros.map((log) => exerciseName(findExercise(log.exercise_id))).filter(Boolean).join(' · ');
    corpo.append(titulo, resumo, nomes);
    const recordes = registros.filter((log) => statsRecordIds.has(log.id)).length;
    item.append(selo, corpo);
    if (recordes) {
      const marca = document.createElement('span');
      marca.className = 'own-badge';
      marca.textContent = recordes === 1 ? t('1 recorde') : t('{0} recordes', recordes);
      item.append(marca);
    }
    lista.append(item);
  });
}

/* Eventos --------------------------------------------------------------------------- */

function reloadFitStats() {
  loadFitStats().catch((error) => showToast(t('Não foi possível carregar as estatísticas. {0}', describeDatabaseError(error)), 'error'));
}

document.querySelectorAll('[data-stats-range]').forEach((botao) => botao.addEventListener('click', () => {
  statsRange = botao.dataset.statsRange;
  renderFitStats();
}));
document.querySelectorAll('[data-stats-metric]').forEach((botao) => botao.addEventListener('click', () => {
  statsMetric = botao.dataset.statsMetric;
  renderLiftProgress();
}));
document.querySelectorAll('[data-volume-metric]').forEach((botao) => botao.addEventListener('click', () => {
  volumeMetric = botao.dataset.volumeMetric;
  setPressed('[data-volume-metric]', 'volumeMetric', volumeMetric);
  renderWeeklyVolume();
}));
document.querySelector('#stats-exercise').addEventListener('change', (event) => {
  statsExerciseId = event.target.value;
  renderLiftProgress();
});
document.addEventListener('nutritrack:language', () => { if (statsLoaded) renderFitStats(); });
// Os gráficos são desenhados na largura real: redesenha quando a tela muda de tamanho.
let statsResizeTimer = null;
window.addEventListener('resize', () => {
  window.clearTimeout(statsResizeTimer);
  statsResizeTimer = window.setTimeout(() => {
    if (statsLoaded && document.querySelector('[data-view="fit-progresso"]').classList.contains('active')) {
      renderLiftProgress();
      renderWeeklyVolume();
    }
  }, 150);
});
