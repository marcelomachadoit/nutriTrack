// FitTrack — interface: troca de aplicativo, treino do dia, ficha e banco de exercícios.
// Os dados ficam em fit.js; aqui só desenho e eventos, no mesmo estilo de ui.js.

const APP_MODE_KEY = 'nutritrack-app-mode';
const APP_HOME = { nutri: 'inicio', fit: 'treino' };
const FIT_VIEWS = new Set(['treino', 'fit-progresso', 'exercicios']);

// Cor do ícone de cada grupo muscular no banco de exercícios.
const MUSCLE_TONES = {
  chest: 'brand', back: 'violet', shoulders: 'amber', traps: 'amber',
  biceps: 'green', triceps: 'green', forearms: 'green', abs: 'slate',
  quads: 'blue', hamstrings: 'blue', glutes: 'blue', calves: 'blue', full_body: 'brand',
};

let appMode = readStoredAppMode();
let exerciseCatalog = [];
let workoutPlan = null;
// exercise_id -> registros do mais recente para o mais antigo.
let exerciseLogs = new Map();
// Treino aberto na tela inicial; null = o treino de hoje.
let fitViewIndex = null;
let fitLoaded = false;
let fitDay = todayKey();
let planDraft = [];
let planSelected = 0;
let planToday = null;
let planPickerTerm = '';
let exerciseFilter = 'all';
let editingExerciseId = null;
let liftTarget = null;

function readStoredAppMode() {
  try { return localStorage.getItem(APP_MODE_KEY) === 'fit' ? 'fit' : 'nutri'; } catch { return 'nutri'; }
}

/* ---------------------------------------------------------
   Troca de aplicativo (NutriTrack <-> FitTrack)
   --------------------------------------------------------- */

function toggleAppMenu(abrir) {
  const menu = document.querySelector('#app-menu');
  const botao = document.querySelector('[data-action="app-switch"]');
  const aberto = abrir ?? menu.hidden;
  menu.hidden = !aberto;
  botao.setAttribute('aria-expanded', String(aberto));
  if (aberto) {
    const atual = menu.querySelector(`[data-app-mode="${appMode}"]`);
    if (atual) atual.focus();
  }
}

function applyAppMode() {
  document.querySelector('#app-shell').dataset.app = appMode;
  document.querySelectorAll('[data-app-nav]').forEach((nav) => { nav.hidden = nav.dataset.appNav !== appMode; });
  const destaque = document.createElement('span');
  destaque.textContent = 'Track';
  document.querySelector('#brand-name').replaceChildren(document.createTextNode(appMode === 'fit' ? 'Fit' : 'Nutri'), destaque);
  document.querySelectorAll('[data-app-mode]').forEach((botao) => {
    const ativo = botao.dataset.appMode === appMode;
    botao.classList.toggle('selected', ativo);
    botao.setAttribute('aria-checked', String(ativo));
  });
}

function storeAppMode(mode) {
  appMode = mode;
  try { localStorage.setItem(APP_MODE_KEY, mode); } catch {}
  applyAppMode();
}

function setAppMode(mode) {
  toggleAppMenu(false);
  const mudou = mode !== appMode;
  showView(APP_HOME[mode]);
  if (mudou) showToast(mode === 'fit' ? t('Você está no FitTrack.') : t('Você está no NutriTrack.'));
}

// Chamada por showView: qualquer caminho que abra uma tela de um dos apps (inclusive links
// internos, como "Ver refeições deste dia") deixa a barra e a navegação do app certo.
// O Perfil é da conta, não de um app: abre sem trocar nada.
function onViewShown(viewName) {
  if (viewName !== 'perfil') {
    const modo = FIT_VIEWS.has(viewName) ? 'fit' : 'nutri';
    if (modo !== appMode) storeAppMode(modo);
  }
  if (viewName === 'treino' && fitLoaded) renderFitHome();
  // As estatísticas leem todo o histórico: recarregam a cada visita para incluir o que
  // acabou de ser registrado na aba Treino.
  if (viewName === 'fit-progresso') {
    renderFitStats();
    reloadFitStats();
  }
}

/* ---------------------------------------------------------
   Carga
   --------------------------------------------------------- */

async function loadFitData() {
  exerciseCatalog = await listExercises();
  workoutPlan = await getWorkoutPlan();
  // Conta nova começa com a ficha ABC, que o usuário muda depois.
  if (!workoutPlan) workoutPlan = await createDefaultPlan();
  await loadPlanLogs();
  fitLoaded = true;
  renderFitHome();
  renderExerciseFilter();
  renderExerciseList();
}

async function createDefaultPlan() {
  const workouts = workoutsFromTemplate(DEFAULT_TEMPLATE, exerciseCatalog);
  // Sem a base de exercícios carregada não há o que montar: a tela explica o que falta.
  if (!workouts.some((workout) => workout.items.length)) return null;
  return saveWorkoutPlan({ workouts, anchor_date: todayKey(), anchor_index: 0 });
}

async function loadPlanLogs() {
  const ids = workoutPlan ? [...new Set(workoutPlan.workouts.flatMap((workout) => workout.items.map((item) => item.exercise_id)))] : [];
  const logs = await getExerciseLogs(ids);
  exerciseLogs = new Map();
  logs.forEach((log) => {
    const chave = String(log.exercise_id);
    if (!exerciseLogs.has(chave)) exerciseLogs.set(chave, []);
    exerciseLogs.get(chave).push(log);
  });
}

function findExercise(id) {
  return exerciseCatalog.find((exercise) => String(exercise.id) === String(id));
}

// Mesmo critério dos alimentos: só a base compartilhada tem tradução.
function exerciseName(exercise) {
  if (!exercise) return '';
  if (currentLanguage === 'en' && exercise.name_en) return exercise.name_en;
  if (currentLanguage === 'es' && exercise.name_es) return exercise.name_es;
  return exercise.name;
}

function muscleLabel(key) {
  return t(MUSCLE_GROUPS[key] || MUSCLE_GROUPS.full_body);
}

function logsOf(exerciseId) {
  return exerciseLogs.get(String(exerciseId)) || [];
}

function todayLogOf(exerciseId) {
  const hoje = todayKey();
  return logsOf(exerciseId).find((log) => log.date === hoje) || null;
}

// "Treino anterior" = o registro mais recente antes de hoje.
function previousLogOf(exerciseId) {
  const hoje = todayKey();
  return logsOf(exerciseId).find((log) => log.date < hoje) || null;
}

// Maior carga registrada antes de hoje; null quando o exercício ainda não tem histórico.
function bestLoadBefore(exerciseId, dateKey) {
  const anteriores = logsOf(exerciseId).filter((log) => log.date < dateKey);
  return anteriores.length ? Math.max(...anteriores.map((log) => log.weight_kg)) : null;
}

function formatLoad(kg) {
  return kg > 0 ? `${formatNumber(kg)} kg` : t('Peso do corpo');
}

function formatLiftLog(log) {
  return `${formatLoad(log.weight_kg)} · ${log.sets} × ${log.reps}`;
}

/* ---------------------------------------------------------
   Treino do dia
   --------------------------------------------------------- */

// Próxima posição da ficha que é treino (pula descansos), a partir de "indice".
function nextWorkoutIndex(workouts, indice) {
  for (let passo = 1; passo <= workouts.length; passo += 1) {
    const candidato = (indice + passo) % workouts.length;
    if (!workouts[candidato].rest) return candidato;
  }
  return indice;
}

// Rótulo curto de uma posição: "Treino B" ou "Descanso".
function planDayLabel(workouts, indice) {
  return workouts[indice].rest ? t('Descanso') : t('Treino {0}', workoutLetters(workouts)[indice]);
}

// Botão-aba de uma posição da ficha, igual na tela inicial e no editor.
function buildDayTab(workout, letra, legendaTexto) {
  const aba = document.createElement('button');
  aba.type = 'button';
  aba.className = `workout-tab${workout.rest ? ' is-rest' : ''}`;
  const marca = document.createElement('b');
  if (workout.rest) marca.append(createIcon('i-moon'));
  else marca.textContent = letra;
  const legenda = document.createElement('small');
  legenda.textContent = legendaTexto;
  aba.append(marca, legenda);
  return aba;
}

function renderFitHome() {
  const hoje = todayKey();
  fitDay = hoje;
  const extenso = parseDateKey(hoje).toLocaleDateString(appLocale(), { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
  document.querySelector('#fit-today-label').textContent = t('HOJE · {0}', extenso);
  const nome = document.createElement('span');
  nome.textContent = document.querySelector('#user-name').textContent;
  document.querySelector('#fit-hello').replaceChildren(document.createTextNode(`${t('Bora treinar,')} `), nome);

  const abas = document.querySelector('#workout-tabs');
  const semana = document.querySelector('#fit-week');
  const nota = document.querySelector('#workout-note');
  const lista = document.querySelector('#lift-list');
  abas.replaceChildren();
  semana.replaceChildren();
  nota.replaceChildren();
  lista.replaceChildren();

  if (!workoutPlan || !countWorkouts(workoutPlan.workouts)) {
    nota.hidden = true;
    semana.hidden = true;
    renderFitHero(null);
    const vazio = document.createElement('p');
    vazio.className = 'empty-state';
    if (!fitLoaded) vazio.textContent = t('Carregando seu treino...');
    else if (!exerciseCatalog.length) vazio.textContent = t('A base de exercícios está vazia. Rode o supabase-exercises.sql no SQL Editor do Supabase.');
    else vazio.textContent = t('Sua ficha está vazia. Use "Editar ficha" para montar seus treinos.');
    lista.append(vazio);
    return;
  }

  const workouts = workoutPlan.workouts;
  const letras = workoutLetters(workouts);
  const indiceHoje = workoutIndexFor(workoutPlan, hoje);
  if (fitViewIndex !== null && fitViewIndex >= workouts.length) fitViewIndex = null;
  const indice = fitViewIndex ?? indiceHoje;
  const treino = workouts[indice];

  workouts.forEach((workout, i) => {
    const legenda = i === indiceHoje ? t('Hoje') : (workout.rest ? t('Descanso') : workout.name);
    const aba = buildDayTab(workout, letras[i], legenda);
    aba.classList.toggle('selected', i === indice);
    aba.classList.toggle('is-today', i === indiceHoje);
    aba.setAttribute('aria-pressed', String(i === indice));
    const descricao = workout.rest ? t('Dia de descanso') : t('Treino {0}: {1}', letras[i], workout.name);
    aba.setAttribute('aria-label', i === indiceHoje ? t('{0} (hoje)', descricao) : descricao);
    aba.addEventListener('click', () => {
      fitViewIndex = i === indiceHoje ? null : i;
      renderFitHome();
    });
    abas.append(aba);
  });

  renderFitWeek(semana, indice);

  // Olhando outro dia da ficha: oferece trocar o de hoje, e a sequência segue a partir dele.
  nota.hidden = indice === indiceHoje;
  if (indice !== indiceHoje) {
    const texto = document.createElement('span');
    const deHoje = workouts[indiceHoje].rest ? t('Hoje é dia de descanso.') : t('Hoje é dia do treino {0}.', letras[indiceHoje]);
    texto.textContent = `${deHoje} ${treino.rest ? t('Quer descansar hoje?') : t('Quer fazer o {0} no lugar?', letras[indice])}`;
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'text-button';
    botao.append(createIcon(treino.rest ? 'i-moon' : 'i-calendar'), document.createTextNode(treino.rest ? t('Descansar hoje') : t('Fazer o {0} hoje', letras[indice])));
    botao.addEventListener('click', () => makeTodayWorkout(indice));
    nota.append(texto, botao);
  }

  if (treino.rest) {
    const proximo = nextWorkoutIndex(workouts, indice);
    renderFitHero({ rest: true, hoje: indice === indiceHoje, proximo: `${t('Treino {0}', letras[proximo])} · ${workouts[proximo].name}` });
    lista.append(buildRestCard(indice === indiceHoje ? proximo : null, letras[proximo]));
    return;
  }

  const itens = treino.items.filter((item) => findExercise(item.exercise_id));
  const series = itens.reduce((soma, item) => soma + Number(item.sets || 0), 0);
  const feitos = itens.filter((item) => todayLogOf(item.exercise_id)).length;
  renderFitHero({ letra: letras[indice], nome: treino.name, hoje: indice === indiceHoje, total: itens.length, series, feitos });

  if (!itens.length) {
    const vazio = document.createElement('p');
    vazio.className = 'empty-state';
    vazio.textContent = t('Este treino está sem exercícios. Use "Editar ficha" para incluir.');
    lista.append(vazio);
    return;
  }
  itens.forEach((item, posicao) => lista.append(buildLiftCard(item, posicao)));
}

// Os próximos 7 dias do calendário com o que cai em cada um: deixa claro onde estão os
// descansos na semana. Tocar num dia abre aquele treino.
function renderFitWeek(caixa, indiceAberto) {
  caixa.hidden = false;
  const workouts = workoutPlan.workouts;
  const letras = workoutLetters(workouts);
  const hoje = todayKey();
  for (let i = 0; i < 7; i += 1) {
    const dia = addDaysToKey(hoje, i);
    const indice = workoutIndexFor(workoutPlan, dia);
    const workout = workouts[indice];
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = `week-day${workout.rest ? ' is-rest' : ''}${i === 0 ? ' is-today' : ''}${indice === indiceAberto ? ' is-open' : ''}`;
    botao.setAttribute('aria-label', `${formatLongDay(dia)}: ${workout.rest ? t('Dia de descanso') : t('Treino {0}: {1}', letras[indice], workout.name)}`);
    const nome = document.createElement('small');
    nome.textContent = i === 0 ? t('Hoje') : weekdayName(parseDateKey(dia), 'short');
    const marca = document.createElement('b');
    if (workout.rest) marca.append(createIcon('i-moon'));
    else marca.textContent = letras[indice];
    botao.append(nome, marca);
    botao.addEventListener('click', () => {
      fitViewIndex = indice === workoutIndexFor(workoutPlan, hoje) ? null : indice;
      renderFitHome();
    });
    caixa.append(botao);
  }
}

function renderFitHero(info) {
  const hero = document.querySelector('.fit-hero');
  const titulo = document.querySelector('#fit-workout-title');
  const forte = document.createElement('strong');
  hero.classList.toggle('is-rest', Boolean(info && info.rest));
  if (info && info.rest) {
    document.querySelector('#fit-kicker').textContent = info.hoje ? t('HOJE') : t('DESCANSO');
    forte.textContent = t('Próximo: {0}', info.proximo);
    titulo.replaceChildren(document.createTextNode(t('Dia de descanso')), document.createElement('br'), forte);
    document.querySelector('#fit-greeting').textContent = info.hoje
      ? t('Hoje é dia de descanso. Recupere-se bem!')
      : t('Veja o treino do dia e registre suas cargas.');
    return;
  }
  const total = info ? info.total : 0;
  const feitos = info ? info.feitos : 0;
  document.querySelector('#fit-kicker').textContent = !info || info.hoje ? t('TREINO DE HOJE') : t('TREINO {0}', info.letra);
  if (info) {
    forte.textContent = info.nome;
    titulo.replaceChildren(document.createTextNode(t('Treino {0}', info.letra)), document.createElement('br'), forte);
  } else {
    titulo.textContent = '—';
  }
  document.querySelector('#fit-exercise-count').textContent = String(total);
  document.querySelector('#fit-set-count').textContent = String(info ? info.series : 0);
  document.querySelector('#fit-done-count').textContent = String(feitos);
  document.querySelector('#fit-done-label').textContent = t('de {0} feitos', total);
  const proporcao = total ? feitos / total : 0;
  document.querySelector('#fit-ring-progress').style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - proporcao));
  document.querySelector('#fit-greeting').textContent = total && feitos === total
    ? t('Treino concluído. Bom trabalho!')
    : t('Veja o treino do dia e registre suas cargas.');
}

// No lugar da lista de exercícios num dia de descanso. Se o descanso é hoje, oferece
// treinar mesmo assim com o próximo treino da sequência.
function buildRestCard(proximoHoje, letraProxima) {
  const card = document.createElement('article');
  card.className = 'rest-card';
  const icone = document.createElement('span');
  icone.className = 'rest-icon';
  icone.append(createIcon('i-moon'));
  const texto = document.createElement('div');
  const titulo = document.createElement('h3');
  titulo.textContent = t('Dia de descanso');
  const corpo = document.createElement('p');
  corpo.textContent = t('Descanso também é treino: é quando o músculo se recupera e cresce. Hidrate-se, durma bem e caminhe se quiser se movimentar.');
  texto.append(titulo, corpo);
  card.append(icone, texto);
  if (proximoHoje !== null) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'pill-button ghost';
    botao.append(createIcon('i-dumbbell'), document.createTextNode(t('Treinar mesmo assim: fazer o {0}', letraProxima)));
    botao.addEventListener('click', () => makeTodayWorkout(proximoHoje));
    card.append(botao);
  }
  return card;
}

// Cartão do exercício: à esquerda o que foi feito no treino anterior, ao lado o botão
// "Novos dados" — que, depois de registrado, passa a mostrar o valor de hoje.
function buildLiftCard(item, posicao) {
  const exercise = findExercise(item.exercise_id);
  const hojeLog = todayLogOf(exercise.id);
  const anterior = previousLogOf(exercise.id);

  const card = document.createElement('article');
  card.className = `lift-card${hojeLog ? ' is-done' : ''}`;

  const head = document.createElement('div');
  head.className = 'lift-head';
  const ordem = document.createElement('span');
  ordem.className = 'lift-order';
  if (hojeLog) ordem.append(createIcon('i-check'));
  else ordem.textContent = String(posicao + 1);
  const info = document.createElement('div');
  info.className = 'lift-info';
  const nome = document.createElement('h3');
  nome.textContent = exerciseName(exercise);
  const meta = document.createElement('p');
  const grupo = document.createElement('span');
  grupo.className = `muscle-chip tone-${MUSCLE_TONES[exercise.muscle_group] || 'brand'}`;
  grupo.textContent = muscleLabel(exercise.muscle_group);
  meta.append(grupo, document.createTextNode(t('{0} séries × {1}', item.sets, item.reps)));
  info.append(nome, meta);
  head.append(ordem, info);

  const dados = document.createElement('div');
  dados.className = 'lift-data';

  const ultimo = document.createElement('div');
  ultimo.className = 'lift-stat';
  const ultimoRotulo = document.createElement('span');
  ultimoRotulo.append(createIcon('i-history'), document.createTextNode(t('Treino anterior')));
  const ultimoValor = document.createElement('strong');
  ultimoValor.textContent = anterior ? formatLiftLog(anterior) : '—';
  const ultimoData = document.createElement('small');
  ultimoData.textContent = anterior ? formatLongDay(anterior.date) : t('Sem registro ainda');
  ultimo.append(ultimoRotulo, ultimoValor, ultimoData);

  const novo = document.createElement('button');
  novo.type = 'button';
  novo.className = `lift-new${hojeLog ? ' has-value' : ''}`;
  if (hojeLog) {
    novo.setAttribute('aria-label', t('Editar o registro de hoje de {0}', exerciseName(exercise)));
    const rotulo = document.createElement('span');
    rotulo.append(createIcon('i-check'), document.createTextNode(t('Hoje')));
    const valor = document.createElement('strong');
    valor.textContent = formatLiftLog(hojeLog);
    const comparacao = document.createElement('small');
    const delta = anterior ? hojeLog.weight_kg - anterior.weight_kg : null;
    if (delta === null) comparacao.textContent = t('Primeiro registro');
    else if (Math.abs(delta) < 0.01) comparacao.textContent = t('Mesma carga do anterior');
    else {
      comparacao.textContent = delta > 0
        ? t('+{0} kg desde o anterior', formatNumber(delta))
        : t('−{0} kg desde o anterior', formatNumber(Math.abs(delta)));
      comparacao.className = delta > 0 ? 'is-up' : 'is-down';
    }
    const melhorAntes = bestLoadBefore(exercise.id, hojeLog.date);
    if (melhorAntes !== null && hojeLog.weight_kg > melhorAntes) {
      comparacao.textContent = `${comparacao.textContent} · ${t('novo recorde')}`;
      comparacao.className = 'is-up';
    }
    novo.append(rotulo, valor, comparacao);
  } else {
    novo.setAttribute('aria-label', t('Novos dados de {0}', exerciseName(exercise)));
    const icone = document.createElement('span');
    icone.className = 'lift-new-icon';
    icone.append(createIcon('i-plus'));
    const texto = document.createElement('strong');
    texto.textContent = t('Novos dados');
    const dica = document.createElement('small');
    dica.textContent = t('Registrar hoje');
    novo.append(icone, texto, dica);
  }
  novo.addEventListener('click', () => openLiftDialog(item));

  dados.append(ultimo, novo);
  card.append(head, dados);
  return card;
}

async function makeTodayWorkout(indice) {
  try {
    workoutPlan = await saveWorkoutPlan({ ...workoutPlan, anchor_date: todayKey(), anchor_index: indice });
    fitViewIndex = null;
    renderFitHome();
    showToast(t('{0} definido para hoje. A sequência continua a partir dele.', planDayLabel(workoutPlan.workouts, indice)));
  } catch (error) {
    showToast(t('Não foi possível trocar o treino. {0}', describeDatabaseError(error)), 'error');
  }
}

/* Registrar carga ------------------------------------------------------- */

function firstNumber(texto) {
  const achado = String(texto || '').match(/\d+/);
  return achado ? Number(achado[0]) : '';
}

function openLiftDialog(item) {
  const exercise = findExercise(item.exercise_id);
  if (!exercise) return;
  const hojeLog = todayLogOf(exercise.id);
  const anterior = previousLogOf(exercise.id);
  liftTarget = { exercise, item, todayLog: hojeLog };

  document.querySelector('#lift-dialog-title').textContent = exerciseName(exercise);
  document.querySelector('#lift-dialog-hint').textContent = t('{0} · previsto na ficha: {1} séries × {2}', muscleLabel(exercise.muscle_group), item.sets, item.reps);

  const caixa = document.querySelector('#lift-previous');
  caixa.replaceChildren();
  const rotulo = document.createElement('span');
  rotulo.append(createIcon('i-history'), document.createTextNode(anterior ? t('Treino anterior · {0}', formatLongDay(anterior.date)) : t('Treino anterior')));
  const valor = document.createElement('strong');
  valor.textContent = anterior ? formatLiftLog(anterior) : t('Primeira vez registrando este exercício.');
  caixa.append(rotulo, valor);

  // Parte do que já está registrado hoje; senão, do treino anterior; senão, do previsto na ficha.
  const base = hojeLog || anterior;
  document.querySelector('#lift-weight').value = base ? base.weight_kg : '';
  document.querySelector('#lift-sets').value = base ? base.sets : item.sets;
  document.querySelector('#lift-reps').value = base ? base.reps : firstNumber(item.reps);
  document.querySelector('#lift-delete').hidden = !hojeLog;
  document.querySelector('#lift-submit').textContent = hojeLog ? t('Salvar alterações') : t('Salvar');
  document.querySelector('#lift-feedback').textContent = '';
  openDialog('lift-dialog');
}

function storeLocalLog(log) {
  const normalizado = { ...log, weight_kg: Number(log.weight_kg) };
  const chave = String(normalizado.exercise_id);
  const lista = logsOf(chave).filter((item) => item.date !== normalizado.date);
  lista.push(normalizado);
  lista.sort((a, b) => (a.date < b.date ? 1 : -1));
  exerciseLogs.set(chave, lista);
}

async function handleLiftSubmit(event) {
  event.preventDefault();
  if (!liftTarget) return;
  const feedback = document.querySelector('#lift-feedback');
  const botao = document.querySelector('#lift-submit');
  const pesoBruto = document.querySelector('#lift-weight').value.trim();
  const valores = {
    weight_kg: Number(pesoBruto),
    sets: Number(document.querySelector('#lift-sets').value),
    reps: Number(document.querySelector('#lift-reps').value),
  };
  if (pesoBruto === '' || !Number.isFinite(valores.weight_kg) || valores.weight_kg < LOG_LIMITS.weight.min || valores.weight_kg > LOG_LIMITS.weight.max) {
    feedback.textContent = t('Informe uma carga entre {0} e {1} kg.', LOG_LIMITS.weight.min, LOG_LIMITS.weight.max);
    return;
  }
  if (!Number.isInteger(valores.sets) || valores.sets < LOG_LIMITS.sets.min || valores.sets > LOG_LIMITS.sets.max) {
    feedback.textContent = t('Informe de {0} a {1} séries.', LOG_LIMITS.sets.min, LOG_LIMITS.sets.max);
    return;
  }
  if (!Number.isInteger(valores.reps) || valores.reps < LOG_LIMITS.reps.min || valores.reps > LOG_LIMITS.reps.max) {
    feedback.textContent = t('Informe de {0} a {1} repetições.', LOG_LIMITS.reps.min, LOG_LIMITS.reps.max);
    return;
  }
  botao.disabled = true;
  feedback.textContent = '';
  try {
    const melhorAntes = bestLoadBefore(liftTarget.exercise.id, todayKey());
    const salvo = await saveExerciseLog(liftTarget.exercise.id, todayKey(), valores);
    storeLocalLog(salvo);
    closeDialog('lift-dialog');
    if (melhorAntes !== null && valores.weight_kg > melhorAntes) {
      showToast(t('Novo recorde em {0}: {1}!', exerciseName(liftTarget.exercise), formatLoad(valores.weight_kg)));
    } else {
      showToast(liftTarget.todayLog ? t('Registro atualizado.') : t('Carga registrada.'));
    }
    renderFitHome();
  } catch (error) {
    feedback.textContent = t('Não foi possível registrar. {0}', describeDatabaseError(error));
  } finally {
    botao.disabled = false;
  }
}

async function removeTodayLog() {
  if (!liftTarget || !liftTarget.todayLog) return;
  if (!window.confirm(t('Apagar o registro de hoje de “{0}”?', exerciseName(liftTarget.exercise)))) return;
  try {
    await deleteExerciseLog(liftTarget.todayLog.id);
    const chave = String(liftTarget.exercise.id);
    exerciseLogs.set(chave, logsOf(chave).filter((log) => log.id !== liftTarget.todayLog.id));
    closeDialog('lift-dialog');
    showToast(t('Registro apagado.'));
    renderFitHome();
  } catch (error) {
    document.querySelector('#lift-feedback').textContent = t('Não foi possível apagar. {0}', describeDatabaseError(error));
  }
}

/* ---------------------------------------------------------
   Editar ficha
   --------------------------------------------------------- */

function openPlanDialog() {
  if (!exerciseCatalog.length) {
    showToast(t('A base de exercícios está vazia. Rode o supabase-exercises.sql no SQL Editor do Supabase.'), 'error');
    return;
  }
  const origem = workoutPlan ? workoutPlan.workouts : workoutsFromTemplate(DEFAULT_TEMPLATE, exerciseCatalog);
  // origin guarda a posição original de cada dia: é como o dia de hoje é reencontrado
  // depois que a ordem muda.
  planDraft = origem.map((workout, i) => ({
    origin: workoutPlan ? i : null,
    rest: Boolean(workout.rest),
    name: workout.name || '',
    items: (workout.items || []).filter((item) => findExercise(item.exercise_id)).map((item) => ({ exercise_id: item.exercise_id, sets: Number(item.sets), reps: String(item.reps) })),
  }));
  planToday = workoutPlan ? workoutIndexFor(workoutPlan, todayKey()) : null;
  planSelected = Math.min(fitViewIndex ?? planToday ?? 0, planDraft.length - 1);
  planPickerTerm = '';
  document.querySelector('#plan-feedback').textContent = '';
  renderPlanDraft();
  openDialog('plan-dialog');
}

function renderPlanDraft() {
  renderPlanTabs();
  renderPlanWorkout();
}

function renderPlanTabs() {
  const abas = document.querySelector('#plan-tabs');
  abas.replaceChildren();
  const letras = workoutLetters(planDraft);

  // O ciclo por extenso, com os descansos no lugar deles: "A · B · Descanso · C".
  const ciclo = document.querySelector('#plan-cycle');
  ciclo.replaceChildren();
  const rotulo = document.createElement('strong');
  rotulo.textContent = planDraft.length === 1 ? t('Ciclo de 1 dia') : t('Ciclo de {0} dias', planDraft.length);
  ciclo.append(rotulo, document.createTextNode(` · ${planDraft.map((workout, i) => (workout.rest ? t('descanso') : letras[i])).join(' → ')}`));

  planDraft.forEach((workout, i) => {
    const aba = buildDayTab(workout, letras[i], workout.rest ? t('Descanso') : (workout.name.trim() || t('Sem nome')));
    aba.classList.toggle('selected', i === planSelected);
    aba.setAttribute('aria-pressed', String(i === planSelected));
    aba.addEventListener('click', () => {
      planSelected = i;
      renderPlanDraft();
    });
    abas.append(aba);
  });

  const cabeDia = planDraft.length < MAX_PLAN_DAYS;
  if (cabeDia && countWorkouts(planDraft) < MAX_WORKOUTS) {
    const proxima = workoutLetter(countWorkouts(planDraft));
    const novo = buildDayTab({}, '', t('Treino {0}', proxima));
    novo.classList.add('add');
    novo.querySelector('b').replaceChildren(createIcon('i-plus'));
    novo.setAttribute('aria-label', t('Acrescentar treino {0}', proxima));
    novo.addEventListener('click', () => {
      planDraft.push({ origin: null, rest: false, name: '', items: [] });
      planSelected = planDraft.length - 1;
      renderPlanDraft();
      document.querySelector('#plan-workout-name').focus();
    });
    abas.append(novo);
  }
  if (cabeDia) {
    const descanso = buildDayTab({ rest: true }, '', t('Descanso'));
    descanso.classList.add('add');
    descanso.querySelector('b').replaceChildren(createIcon('i-plus'));
    descanso.setAttribute('aria-label', t('Acrescentar dia de descanso'));
    descanso.addEventListener('click', () => {
      planDraft.push({ origin: null, rest: true, name: '', items: [] });
      planSelected = planDraft.length - 1;
      renderPlanDraft();
    });
    abas.append(descanso);
  }
}

function renderPlanWorkout() {
  const caixa = document.querySelector('#plan-workout');
  caixa.replaceChildren();
  const workout = planDraft[planSelected];
  const letra = workoutLetters(planDraft)[planSelected];
  const rotuloDia = workout.rest ? t('o descanso') : t('o treino {0}', letra);
  caixa.classList.toggle('is-rest', Boolean(workout.rest));

  const head = document.createElement('div');
  head.className = 'plan-workout-head';
  let principal;
  if (workout.rest) {
    principal = document.createElement('div');
    principal.className = 'plan-rest-info';
    const icone = document.createElement('span');
    icone.className = 'rest-icon';
    icone.append(createIcon('i-moon'));
    const texto = document.createElement('div');
    const titulo = document.createElement('strong');
    titulo.textContent = t('Dia de descanso');
    const dica = document.createElement('small');
    dica.textContent = t('Sem exercícios. Use as setas para colocar o descanso no ponto certo do ciclo.');
    texto.append(titulo, dica);
    principal.append(icone, texto);
  } else {
    principal = document.createElement('label');
    principal.className = 'field';
    const rotulo = document.createElement('span');
    rotulo.className = 'field-label';
    rotulo.textContent = t('Nome do treino {0}', letra);
    const controle = document.createElement('span');
    controle.className = 'field-control';
    const nome = document.createElement('input');
    nome.id = 'plan-workout-name';
    nome.type = 'text';
    nome.maxLength = 60;
    nome.value = workout.name;
    nome.placeholder = t('Ex.: Peito / Tríceps');
    nome.addEventListener('input', () => {
      workout.name = nome.value;
      const legenda = document.querySelectorAll('#plan-tabs .workout-tab small')[planSelected];
      if (legenda) legenda.textContent = nome.value.trim() || t('Sem nome');
    });
    controle.append(nome);
    principal.append(rotulo, controle);
  }

  const acoes = document.createElement('span');
  acoes.className = 'item-actions';
  const antes = createIconButton('i-chevron-left', 'ghost-button', t('Mover {0} para antes', rotuloDia), () => movePlanWorkout(planSelected, planSelected - 1));
  antes.disabled = planSelected === 0;
  const depois = createIconButton('i-chevron-right', 'ghost-button', t('Mover {0} para depois', rotuloDia), () => movePlanWorkout(planSelected, planSelected + 1));
  depois.disabled = planSelected === planDraft.length - 1;
  const remover = createIconButton('i-trash', 'ghost-button danger', t('Remover {0}', rotuloDia), () => {
    if (!workout.rest && workout.items.length && !window.confirm(t('Remover o treino {0} da ficha? O histórico de cargas continua salvo.', letra))) return;
    planDraft.splice(planSelected, 1);
    planSelected = Math.min(planSelected, planDraft.length - 1);
    renderPlanDraft();
  });
  // A ficha precisa de pelo menos um treino; descansos podem sair sempre.
  remover.disabled = !workout.rest && countWorkouts(planDraft) === 1;
  acoes.append(antes, depois, remover);
  head.append(principal, acoes);
  caixa.append(head);
  if (workout.rest) return;

  const lista = document.createElement('ul');
  lista.className = 'plan-items';
  workout.items.forEach((item, index) => lista.append(buildPlanItem(workout, item, index)));
  if (!workout.items.length) {
    const vazio = document.createElement('li');
    vazio.className = 'empty-state';
    vazio.textContent = t('Nenhum exercício neste treino ainda. Inclua abaixo.');
    lista.append(vazio);
  }
  caixa.append(lista, buildPlanPicker(workout, letra));
}

function buildPlanItem(workout, item, index) {
  const exercise = findExercise(item.exercise_id);
  const nome = exerciseName(exercise);
  const row = document.createElement('li');
  row.className = 'plan-item';
  row.dataset.index = String(index);

  const handle = document.createElement('button');
  handle.className = 'slot-drag';
  handle.type = 'button';
  handle.setAttribute('aria-label', t('Mover {0}. Use as setas para cima e para baixo.', nome));
  handle.title = t('Arraste para reordenar');
  handle.append(createIcon('i-grip'));
  attachDragReorder(handle, row, (ordem) => {
    workout.items = ordem.map((posicao) => workout.items[posicao]);
    renderPlanWorkout();
  });
  handle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    movePlanItem(workout, index, event.key === 'ArrowUp' ? index - 1 : index + 1);
  });

  const info = document.createElement('div');
  info.className = 'plan-item-info';
  const titulo = document.createElement('strong');
  titulo.textContent = nome;
  const grupo = document.createElement('small');
  grupo.textContent = muscleLabel(exercise.muscle_group);
  info.append(titulo, grupo);

  const series = planNumberField('plan-sets', t('séries'), t('Séries de {0}', nome), item.sets, (valor) => { item.sets = Number(valor); });
  const seriesInput = series.querySelector('input');
  seriesInput.type = 'number';
  seriesInput.min = String(LOG_LIMITS.sets.min);
  seriesInput.max = String(LOG_LIMITS.sets.max);
  seriesInput.step = '1';
  seriesInput.inputMode = 'numeric';
  const reps = planNumberField('plan-reps', t('reps'), t('Repetições de {0}', nome), item.reps, (valor) => { item.reps = valor; });
  reps.querySelector('input').maxLength = 20;

  const remover = createIconButton('i-trash', 'ghost-button danger plan-remove', t('Remover {0}', nome), () => {
    workout.items.splice(index, 1);
    renderPlanWorkout();
  });

  row.append(handle, info, series, reps, remover);
  return row;
}

function planNumberField(className, sufixo, rotulo, valor, aoMudar) {
  const controle = document.createElement('span');
  controle.className = `field-control ${className}`;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = String(valor);
  input.setAttribute('aria-label', rotulo);
  input.addEventListener('input', () => aoMudar(input.value));
  const legenda = document.createElement('b');
  legenda.className = 'field-suffix';
  legenda.textContent = sufixo;
  controle.append(input, legenda);
  return controle;
}

function movePlanItem(workout, from, to) {
  if (to < 0 || to >= workout.items.length) return;
  const [item] = workout.items.splice(from, 1);
  workout.items.splice(to, 0, item);
  renderPlanWorkout();
  const handles = document.querySelectorAll('#plan-workout .slot-drag');
  if (handles[to]) handles[to].focus();
}

function movePlanWorkout(from, to) {
  if (to < 0 || to >= planDraft.length) return;
  const [workout] = planDraft.splice(from, 1);
  planDraft.splice(to, 0, workout);
  planSelected = to;
  renderPlanDraft();
}

function exerciseMatches(exercise, termo) {
  return [exercise.name, exercise.name_en, exercise.name_es, muscleLabel(exercise.muscle_group)].some((nome) => nome && normalizeText(nome).includes(termo));
}

function sortExercises(lista) {
  return [...lista].sort((a, b) => exerciseName(a).localeCompare(exerciseName(b), appLocale()));
}

// Busca + lista de exercícios agrupada por músculo, desenhada pelo próprio app em vez de um
// select nativo: o menu do sistema não segue as cores do tema e ficava ilegível. Tocar num
// exercício inclui na hora; o que já está no treino aparece marcado. A busca só redesenha
// a lista, então o campo não perde o foco enquanto se digita.
function buildPlanPicker(workout, letra) {
  const picker = document.createElement('div');
  picker.className = 'plan-picker';

  const busca = document.createElement('label');
  busca.className = 'field';
  const buscaRotulo = document.createElement('span');
  buscaRotulo.className = 'field-label';
  buscaRotulo.textContent = t('Incluir exercício');
  const buscaControle = document.createElement('span');
  buscaControle.className = 'field-control';
  const buscaInput = document.createElement('input');
  buscaInput.type = 'search';
  buscaInput.autocomplete = 'off';
  buscaInput.placeholder = t('Nome ou músculo...');
  buscaInput.value = planPickerTerm;
  buscaControle.append(createIcon('i-search'), buscaInput);
  busca.append(buscaRotulo, buscaControle);

  const resultados = document.createElement('div');
  resultados.className = 'picker-results';
  resultados.setAttribute('aria-label', t('Exercícios para incluir'));

  const incluir = (exercise) => {
    const feedback = document.querySelector('#plan-feedback');
    if (workout.items.length >= MAX_WORKOUT_ITEMS) {
      feedback.textContent = t('O treino {0} passou de {1} exercícios.', letra, MAX_WORKOUT_ITEMS);
      return;
    }
    feedback.textContent = '';
    workout.items.push({ exercise_id: exercise.id, sets: 3, reps: '8–12' });
    // Redesenha o treino mantendo a lista rolada no mesmo ponto.
    const rolagem = resultados.scrollTop;
    renderPlanWorkout();
    const nova = document.querySelector('#plan-workout .picker-results');
    if (nova) nova.scrollTop = rolagem;
  };

  const preencher = () => {
    resultados.replaceChildren();
    const termo = normalizeText(planPickerTerm.trim());
    const encontrados = sortExercises(exerciseCatalog.filter((exercise) => !termo || exerciseMatches(exercise, termo)));
    if (!encontrados.length) {
      const vazio = document.createElement('p');
      vazio.className = 'picker-empty';
      vazio.textContent = t('Nenhum exercício encontrado.');
      resultados.append(vazio);
      return;
    }
    const noTreino = new Set(workout.items.map((item) => String(item.exercise_id)));
    Object.keys(MUSCLE_GROUPS).forEach((grupo) => {
      const doGrupo = encontrados.filter((exercise) => exercise.muscle_group === grupo);
      if (!doGrupo.length) return;
      const titulo = document.createElement('p');
      titulo.className = 'picker-group-title';
      titulo.textContent = muscleLabel(grupo);
      resultados.append(titulo);
      doGrupo.forEach((exercise) => {
        const jaTem = noTreino.has(String(exercise.id));
        const opcao = document.createElement('button');
        opcao.type = 'button';
        opcao.className = `picker-option${jaTem ? ' is-added' : ''}`;
        opcao.disabled = jaTem;
        const nome = document.createElement('span');
        nome.textContent = exerciseName(exercise);
        if (exercise.user_id) {
          const selo = document.createElement('span');
          selo.className = 'own-badge';
          selo.textContent = t('Meu');
          nome.append(' ', selo);
        }
        const acao = document.createElement('span');
        acao.className = 'picker-option-action';
        acao.append(createIcon(jaTem ? 'i-check' : 'i-plus'), document.createTextNode(jaTem ? t('No treino') : t('Incluir')));
        opcao.setAttribute('aria-label', jaTem ? t('{0} já está no treino', exerciseName(exercise)) : t('Incluir {0}', exerciseName(exercise)));
        opcao.append(nome, acao);
        opcao.addEventListener('click', () => incluir(exercise));
        resultados.append(opcao);
      });
    });
  };

  buscaInput.addEventListener('input', () => {
    planPickerTerm = buscaInput.value;
    preencher();
    resultados.scrollTop = 0;
  });
  // Enter na busca submeteria a ficha inteira.
  buscaInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') event.preventDefault(); });

  preencher();
  picker.append(busca, resultados);
  return picker;
}

function applyPlanTemplate(chave) {
  if (!window.confirm(t('Trocar a ficha em edição pelo modelo {0}? Nada é salvo até você tocar em "Salvar ficha".', chave))) return;
  planDraft = workoutsFromTemplate(chave, exerciseCatalog).map((workout) => ({ origin: null, ...workout, rest: Boolean(workout.rest) }));
  planSelected = 0;
  document.querySelector('#plan-feedback').textContent = '';
  renderPlanDraft();
}

async function handlePlanSubmit(event) {
  event.preventDefault();
  const feedback = document.querySelector('#plan-feedback');
  const botao = document.querySelector('#plan-submit');
  planDraft.forEach((workout) => {
    workout.name = workout.name.trim();
    workout.items.forEach((item) => {
      item.sets = Number(item.sets);
      item.reps = String(item.reps).trim();
    });
  });
  const erro = validateWorkoutPlan(planDraft);
  if (erro) {
    feedback.textContent = erro;
    return;
  }
  // O treino de hoje continua o mesmo depois de reordenar: a referência acompanha a nova
  // posição dele. Se ele saiu da ficha, hoje fica com o que ocupou o lugar.
  let indiceHoje = planDraft.findIndex((workout) => workout.origin !== null && workout.origin === planToday);
  if (indiceHoje < 0) indiceHoje = Math.min(planToday ?? 0, planDraft.length - 1);
  botao.disabled = true;
  feedback.textContent = '';
  try {
    workoutPlan = await saveWorkoutPlan({ workouts: planDraft, anchor_date: todayKey(), anchor_index: indiceHoje });
    fitViewIndex = null;
    await loadPlanLogs().catch(() => {});
    closeDialog('plan-dialog');
    showToast(t('Ficha salva.'));
    renderFitHome();
    renderExerciseList();
  } catch (error) {
    feedback.textContent = t('Não foi possível salvar a ficha. {0}', describeDatabaseError(error));
  } finally {
    botao.disabled = false;
  }
}

/* ---------------------------------------------------------
   Banco de exercícios
   --------------------------------------------------------- */

function renderExerciseFilter() {
  const caixa = document.querySelector('#muscle-filter');
  caixa.replaceChildren();
  [['all', t('Todos')], ...Object.keys(MUSCLE_GROUPS).map((grupo) => [grupo, muscleLabel(grupo)])].forEach(([valor, rotulo]) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip${exerciseFilter === valor ? ' selected' : ''}`;
    chip.setAttribute('aria-pressed', String(exerciseFilter === valor));
    chip.textContent = rotulo;
    chip.addEventListener('click', () => {
      exerciseFilter = valor;
      renderExerciseFilter();
      renderExerciseList();
    });
    caixa.append(chip);
  });
}

// Letras dos treinos da ficha em que o exercício aparece ("A, C").
function planLettersOf(exerciseId) {
  if (!workoutPlan) return [];
  const letras = workoutLetters(workoutPlan.workouts);
  return workoutPlan.workouts
    .map((workout, i) => (!workout.rest && workout.items.some((item) => String(item.exercise_id) === String(exerciseId)) ? letras[i] : null))
    .filter(Boolean);
}

function renderExerciseList() {
  const lista = document.querySelector('#exercise-list');
  const contador = document.querySelector('#exercise-count');
  lista.replaceChildren();
  const termo = normalizeText(document.querySelector('#exercise-search').value.trim());
  const encontrados = sortExercises(exerciseCatalog.filter((exercise) => (exerciseFilter === 'all' || exercise.muscle_group === exerciseFilter) && (!termo || exerciseMatches(exercise, termo))));
  contador.textContent = encontrados.length === 1 ? t('1 exercício') : t('{0} exercícios', encontrados.length);

  if (!encontrados.length) {
    const vazio = document.createElement('p');
    vazio.className = 'empty-state';
    if (!fitLoaded) vazio.textContent = t('Carregando exercícios...');
    else if (!exerciseCatalog.length) vazio.textContent = t('A base de exercícios está vazia. Rode o supabase-exercises.sql no SQL Editor do Supabase.');
    else vazio.textContent = t('Nenhum exercício encontrado.');
    lista.append(vazio);
    return;
  }

  encontrados.forEach((exercise) => {
    const card = document.createElement('article');
    card.className = `food-item exercise-item${exercise.user_id ? ' is-own' : ''}`;

    const thumb = document.createElement('span');
    thumb.className = `food-thumb tone-${MUSCLE_TONES[exercise.muscle_group] || 'brand'}`;
    thumb.append(createIcon('i-dumbbell'));

    const body = document.createElement('span');
    body.className = 'food-body';
    const title = document.createElement('span');
    title.className = 'food-title';
    const name = document.createElement('strong');
    name.textContent = exerciseName(exercise);
    title.append(name);
    if (exercise.user_id) {
      const badge = document.createElement('span');
      badge.className = 'own-badge';
      badge.textContent = t('Meu');
      title.append(badge);
    }
    const detalhe = document.createElement('small');
    const letras = planLettersOf(exercise.id);
    detalhe.textContent = letras.length
      ? t('{0} · na ficha: treino {1}', muscleLabel(exercise.muscle_group), letras.join(', '))
      : muscleLabel(exercise.muscle_group);
    body.append(title, detalhe);
    card.append(thumb, body);

    if (exercise.user_id) {
      const actions = document.createElement('span');
      actions.className = 'item-actions';
      actions.append(
        createIconButton('i-edit', 'ghost-button', t('Editar {0}', exerciseName(exercise)), () => openExerciseDialog(exercise)),
        createIconButton('i-trash', 'ghost-button danger', t('Excluir {0}', exerciseName(exercise)), () => removeExercise(exercise)),
      );
      card.append(actions);
    }
    lista.append(card);
  });
}

function openExerciseDialog(exercise = null) {
  editingExerciseId = exercise ? exercise.id : null;
  document.querySelector('#exercise-dialog-title').textContent = exercise ? t('Editar exercício') : t('Novo exercício');
  document.querySelector('#exercise-submit').textContent = exercise ? t('Salvar alterações') : t('Salvar exercício');
  document.querySelector('#exercise-name').value = exercise ? exercise.name : '';
  const select = document.querySelector('#exercise-muscle');
  select.replaceChildren();
  Object.keys(MUSCLE_GROUPS).forEach((grupo) => {
    const option = document.createElement('option');
    option.value = grupo;
    option.textContent = muscleLabel(grupo);
    select.append(option);
  });
  // Exercício novo já vem no grupo que estava filtrado na lista.
  select.value = exercise ? exercise.muscle_group : (exerciseFilter !== 'all' ? exerciseFilter : 'chest');
  document.querySelector('#exercise-feedback').textContent = '';
  openDialog('exercise-dialog');
}

async function handleExerciseSubmit(event) {
  event.preventDefault();
  const feedback = document.querySelector('#exercise-feedback');
  const botao = document.querySelector('#exercise-submit');
  const name = document.querySelector('#exercise-name').value.trim();
  const muscle = document.querySelector('#exercise-muscle').value;
  if (!name) {
    feedback.textContent = t('Dê um nome ao exercício.');
    return;
  }
  if (!MUSCLE_GROUPS[muscle]) {
    feedback.textContent = t('Escolha o grupo muscular.');
    return;
  }
  botao.disabled = true;
  feedback.textContent = '';
  try {
    await saveExercise({ name, muscle_group: muscle }, editingExerciseId);
    closeDialog('exercise-dialog');
    showToast(editingExerciseId ? t('Exercício atualizado.') : t('Exercício criado.'));
    exerciseCatalog = await listExercises();
    renderExerciseList();
    renderFitHome();
  } catch (error) {
    feedback.textContent = error && error.code === '23505'
      ? t('Você já tem um exercício com esse nome.')
      : t('Não foi possível salvar o exercício. {0}', describeDatabaseError(error));
  } finally {
    botao.disabled = false;
  }
}

async function removeExercise(exercise) {
  if (!window.confirm(t('Excluir “{0}”? Os registros de carga dele também serão apagados e ele sai da sua ficha.', exerciseName(exercise)))) return;
  try {
    await deleteExercise(exercise.id);
    // Tira da ficha também, para ela não guardar referência a um exercício que não existe.
    if (workoutPlan && planLettersOf(exercise.id).length) {
      const workouts = workoutPlan.workouts.map((workout) => ({ ...workout, items: workout.items.filter((item) => String(item.exercise_id) !== String(exercise.id)) }));
      workoutPlan = await saveWorkoutPlan({ ...workoutPlan, workouts });
    }
    exerciseLogs.delete(String(exercise.id));
    exerciseCatalog = await listExercises();
    showToast(t('Exercício excluído.'));
    renderExerciseList();
    renderFitHome();
  } catch (error) {
    showToast(t('Não foi possível excluir o exercício. {0}', describeDatabaseError(error)), 'error');
  }
}

/* ---------------------------------------------------------
   Ligações de eventos
   --------------------------------------------------------- */

document.querySelector('[data-action="app-switch"]').addEventListener('click', (event) => {
  event.stopPropagation();
  toggleLanguageMenu(false);
  toggleAppMenu();
});
// O botão de idioma também para a propagação: fecha este menu por conta própria.
document.querySelector('[data-action="language"]').addEventListener('click', () => toggleAppMenu(false));
document.querySelectorAll('[data-app-mode]').forEach((botao) => botao.addEventListener('click', () => setAppMode(botao.dataset.appMode)));
document.addEventListener('click', (event) => {
  if (!event.target.closest('.app-switch')) toggleAppMenu(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || document.querySelector('#app-menu').hidden) return;
  toggleAppMenu(false);
  document.querySelector('[data-action="app-switch"]').focus();
});

document.querySelectorAll('[data-action="edit-plan"]').forEach((botao) => botao.addEventListener('click', openPlanDialog));
document.querySelector('[data-action="new-exercise"]').addEventListener('click', () => openExerciseDialog());
document.querySelector('#exercise-search').addEventListener('input', renderExerciseList);
document.querySelector('#exercise-form').addEventListener('submit', handleExerciseSubmit);
document.querySelector('#lift-form').addEventListener('submit', handleLiftSubmit);
document.querySelector('#lift-delete').addEventListener('click', removeTodayLog);
document.querySelector('#plan-form').addEventListener('submit', handlePlanSubmit);
document.querySelectorAll('[data-template]').forEach((botao) => botao.addEventListener('click', () => applyPlanTemplate(botao.dataset.template)));

document.addEventListener('nutritrack:language', () => {
  if (document.querySelector('#app-shell').hidden) return;
  renderFitHome();
  renderExerciseFilter();
  renderExerciseList();
});

// Virou o dia com o app aberto: a tela passa para o treino do novo dia.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || fitDay === todayKey()) return;
  fitViewIndex = null;
  renderFitHome();
});

applyAppMode();
if (appMode === 'fit') showView(APP_HOME.fit);
