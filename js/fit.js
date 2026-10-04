// FitTrack: exercícios, ficha de treino e registros de carga.
//
// A ficha (workout_plans) é a sequência de dias do ciclo: treinos (A, B, C... na ordem em
// que aparecem) e dias de descanso ({ rest: true }), que não recebem letra. Cada treino lista
// exercícios com séries e repetições previstas. O dia de hoje sai de um ponto de referência
// (anchor_date / anchor_index): a cada dia que passa, avança uma posição e volta ao começo
// depois da última. "Fazer este treino hoje" só move a referência.

// Grupos aceitos pelo banco (exercises_muscle_valid), na ordem em que aparecem nos filtros.
const MUSCLE_GROUPS = {
  chest: 'Peito',
  back: 'Costas',
  shoulders: 'Ombros',
  traps: 'Trapézio',
  biceps: 'Bíceps',
  triceps: 'Tríceps',
  forearms: 'Antebraço',
  abs: 'Abdômen',
  quads: 'Quadríceps',
  hamstrings: 'Posterior de coxa',
  glutes: 'Glúteos',
  calves: 'Panturrilha',
  full_body: 'Corpo inteiro',
};

const MAX_WORKOUTS = 7;
// Treinos + descansos. 14 cabe duas semanas, o bastante para qualquer ciclo semanal.
const MAX_PLAN_DAYS = 14;
const MAX_WORKOUT_ITEMS = 20;
const LOG_LIMITS = { weight: { min: 0, max: 1000 }, sets: { min: 1, max: 20 }, reps: { min: 1, max: 200 } };

// Modelos de ficha. Os exercícios são os slugs de supabase-exercises.sql; os nomes dos treinos
// são traduzidos na hora em que o modelo é aplicado e depois viram dados do usuário.
// ABCDE é a planilha de 5 dias; ABC (padrão) usa os três primeiros dias dela.
// 'rest' é um dia de descanso dentro do ciclo.
const TEMPLATE_DAYS = {
  pushA: { name: 'Peito / Ombro / Tríceps', items: [['supino-inclinado-barra', 3, '6–8'], ['supino-reto-maquina', 3, '8–12'], ['crossover-polia', 3, '12–15'], ['elevacao-lateral-halteres', 4, '12–20'], ['triceps-frances-polia', 3, '10–15'], ['triceps-polia-barra', 3, '10–15'], ['abdominal-polia', 3, '8–15']] },
  pullA: { name: 'Costas / Bíceps / Antebraço', items: [['barra-fixa-pronada', 3, '6–10'], ['remada-apoiada-peito', 3, '8–12'], ['puxada-alta-neutra', 3, '10–12'], ['crucifixo-reverso-maquina', 3, '12–20'], ['rosca-inclinada-halteres', 3, '8–12'], ['rosca-martelo', 3, '10–15'], ['rosca-punho', 2, '12–20'], ['rosca-punho-inversa', 2, '12–20'], ['elevacao-pernas-suspenso', 3, '8–15']] },
  legsA: { name: 'Pernas', items: [['agachamento-livre', 3, '5–8'], ['leg-press', 3, '8–12'], ['stiff', 3, '8–10'], ['afundo-bulgaro', 2, '8–12'], ['cadeira-extensora', 3, '10–15'], ['mesa-flexora', 3, '10–15'], ['panturrilha-em-pe', 4, '10–15']] },
  pushB: { name: 'Ombro / Peito / Tríceps', items: [['desenvolvimento-halteres', 3, '6–10'], ['supino-inclinado-halteres', 3, '8–12'], ['peck-deck', 3, '12–15'], ['elevacao-lateral-polia', 4, '12–20'], ['crucifixo-reverso-polia', 3, '12–20'], ['triceps-testa', 3, '8–12'], ['triceps-polia-corda', 3, '12–15'], ['roda-abdominal', 3, '10–15']] },
  pullLegsB: { name: 'Costas / Bíceps / Pernas', items: [['remada-curvada-barra', 3, '6–10'], ['puxada-alta-aberta', 3, '8–12'], ['remada-baixa-unilateral', 2, '10–12'], ['elevacao-lateral-halteres', 3, '12–20'], ['rosca-bayesian', 3, '10–12'], ['rosca-scott-maquina', 2, '10–15'], ['cadeira-flexora', 3, '10–15'], ['cadeira-extensora', 3, '10–15'], ['panturrilha-sentado', 3, '12–20']] },
  upper: { name: 'Membros superiores', items: [['supino-reto-barra', 3, '6–10'], ['remada-curvada-barra', 3, '8–10'], ['desenvolvimento-halteres', 3, '8–12'], ['puxada-alta-aberta', 3, '10–12'], ['rosca-direta-barra', 3, '10–12'], ['triceps-polia-corda', 3, '10–15']] },
  lower: { name: 'Membros inferiores', items: [['agachamento-livre', 3, '6–8'], ['stiff', 3, '8–10'], ['leg-press', 3, '10–12'], ['mesa-flexora', 3, '10–15'], ['panturrilha-em-pe', 4, '12–15'], ['prancha', 3, '30–60 s']] },
  chestTri: { name: 'Peito / Tríceps', items: [['supino-reto-barra', 3, '6–10'], ['supino-inclinado-halteres', 3, '8–12'], ['crossover-polia', 3, '12–15'], ['triceps-testa', 3, '8–12'], ['triceps-polia-corda', 3, '10–15']] },
  backBi: { name: 'Costas / Bíceps', items: [['barra-fixa-pronada', 3, '6–10'], ['remada-curvada-barra', 3, '8–10'], ['puxada-alta-neutra', 3, '10–12'], ['rosca-direta-barra', 3, '8–12'], ['rosca-martelo', 3, '10–15']] },
  shouldersAbs: { name: 'Ombros / Abdômen', items: [['desenvolvimento-militar', 3, '6–10'], ['elevacao-lateral-halteres', 4, '12–20'], ['crucifixo-reverso-maquina', 3, '12–20'], ['encolhimento-halteres', 3, '10–15'], ['abdominal-polia', 3, '10–15'], ['prancha', 3, '30–60 s']] },
};

const WORKOUT_TEMPLATES = {
  AB: ['upper', 'lower', 'rest'],
  ABC: ['pushA', 'pullA', 'legsA', 'rest'],
  ABCD: ['chestTri', 'backBi', 'rest', 'legsA', 'shouldersAbs', 'rest'],
  // A planilha de 5 dias numa semana: cinco treinos e o fim de semana de descanso.
  ABCDE: ['pushA', 'pullA', 'legsA', 'pushB', 'pullLegsB', 'rest', 'rest'],
};
const DEFAULT_TEMPLATE = 'ABC';

function workoutLetter(index) {
  return String.fromCharCode(65 + index);
}

// Letra de cada posição da ficha; descanso fica com null e não consome letra.
function workoutLetters(workouts) {
  let treinos = 0;
  return workouts.map((workout) => (workout.rest ? null : workoutLetter(treinos++)));
}

function countWorkouts(workouts) {
  return workouts.filter((workout) => !workout.rest).length;
}

/* ---------------------------------------------------------
   Exercícios
   --------------------------------------------------------- */

// Base compartilhada + exercícios do próprio usuário: quem separa os dois é a RLS.
async function listExercises() {
  if (!hasSupabase()) return [];
  const { data, error } = await supabaseClient.from('exercises').select('*').order('name').limit(1000);
  if (error) throw error;
  return data;
}

async function saveExercise(exercise, exerciseId = null) {
  const user = await getCurrentUser();
  if (!user) return null;
  const payload = { name: exercise.name, muscle_group: exercise.muscle_group, user_id: user.id };
  const query = exerciseId
    ? supabaseClient.from('exercises').update(payload).eq('id', exerciseId)
    : supabaseClient.from('exercises').insert(payload);
  const { data, error } = await query.select('*').single();
  if (error) throw error;
  return data;
}

// Apagar o exercício leva junto os registros dele (on delete cascade em exercise_logs).
async function deleteExercise(exerciseId) {
  const { error } = await supabaseClient.from('exercises').delete().eq('id', exerciseId);
  if (error) throw error;
}

/* ---------------------------------------------------------
   Ficha de treino
   --------------------------------------------------------- */

async function getWorkoutPlan() {
  if (!hasSupabase()) return null;
  const { data, error } = await supabaseClient.from('workout_plans').select('*').maybeSingle();
  if (error) throw error;
  return data;
}

async function saveWorkoutPlan(plan) {
  const user = await getCurrentUser();
  if (!user) return null;
  const payload = {
    user_id: user.id,
    workouts: plan.workouts.map((workout) => (workout.rest
      ? { rest: true, name: '', items: [] }
      : {
        name: workout.name,
        items: workout.items.map((item) => ({ exercise_id: item.exercise_id, sets: item.sets, reps: item.reps })),
      })),
    anchor_date: plan.anchor_date,
    anchor_index: plan.anchor_index,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseClient.from('workout_plans').upsert(payload, { onConflict: 'user_id' }).select('*').single();
  if (error) throw error;
  return data;
}

// Monta os treinos de um modelo com os ids da base atual. Exercício que não existe na base
// (carga de supabase-exercises.sql ainda não rodou, por exemplo) fica de fora sem erro.
function workoutsFromTemplate(templateKey, exercises) {
  const porSlug = new Map(exercises.filter((exercise) => exercise.slug).map((exercise) => [exercise.slug, exercise]));
  return (WORKOUT_TEMPLATES[templateKey] || WORKOUT_TEMPLATES[DEFAULT_TEMPLATE]).map((dayKey) => {
    if (dayKey === 'rest') return { rest: true, name: '', items: [] };
    const day = TEMPLATE_DAYS[dayKey];
    return {
      name: t(day.name),
      items: day.items
        .filter(([slug]) => porSlug.has(slug))
        .map(([slug, sets, reps]) => ({ exercise_id: porSlug.get(slug).id, sets, reps })),
    };
  });
}

// Posição da ficha num dia: anda uma posição por dia a partir da referência e dá a volta.
// Pode cair num descanso.
function workoutIndexFor(plan, dateKey) {
  const total = plan.workouts.length;
  if (!total) return 0;
  const dias = Math.round((parseDateKey(dateKey) - parseDateKey(plan.anchor_date)) / 86400000);
  return (((plan.anchor_index + dias) % total) + total) % total;
}

function validateWorkoutPlan(workouts) {
  if (!countWorkouts(workouts)) return t('Mantenha pelo menos um treino na ficha.');
  if (countWorkouts(workouts) > MAX_WORKOUTS) return t('A ficha aceita no máximo {0} treinos.', MAX_WORKOUTS);
  if (workouts.length > MAX_PLAN_DAYS) return t('A ficha aceita no máximo {0} dias, contando os descansos.', MAX_PLAN_DAYS);
  const letras = workoutLetters(workouts);
  for (const [index, workout] of workouts.entries()) {
    if (workout.rest) continue;
    const letra = letras[index];
    if (!workout.name.trim()) return t('Dê um nome ao treino {0}.', letra);
    if (!workout.items.length) return t('O treino {0} está sem exercícios.', letra);
    if (workout.items.length > MAX_WORKOUT_ITEMS) return t('O treino {0} passou de {1} exercícios.', letra, MAX_WORKOUT_ITEMS);
    for (const item of workout.items) {
      if (!Number.isInteger(item.sets) || item.sets < LOG_LIMITS.sets.min || item.sets > LOG_LIMITS.sets.max) {
        return t('No treino {0}, use de {1} a {2} séries por exercício.', letra, LOG_LIMITS.sets.min, LOG_LIMITS.sets.max);
      }
      if (!String(item.reps).trim() || String(item.reps).length > 20) {
        return t('No treino {0}, informe as repetições de cada exercício (ex.: 8–12).', letra);
      }
    }
  }
  return null;
}

/* ---------------------------------------------------------
   Registros de carga
   --------------------------------------------------------- */

// Histórico dos exercícios pedidos, do mais recente para o mais antigo.
async function getExerciseLogs(exerciseIds) {
  if (!hasSupabase() || !exerciseIds.length) return [];
  const { data, error } = await supabaseClient
    .from('exercise_logs')
    .select('id, exercise_id, date, weight_kg, sets, reps')
    .in('exercise_id', exerciseIds)
    .order('date', { ascending: false })
    .limit(2000);
  if (error) throw error;
  return data.map((log) => ({ ...log, weight_kg: Number(log.weight_kg) }));
}

// Todo o histórico da conta, do mais antigo para o mais recente: base das estatísticas.
// A RLS limita às linhas do próprio usuário.
async function getAllExerciseLogs() {
  if (!hasSupabase()) return [];
  const { data, error } = await supabaseClient
    .from('exercise_logs')
    .select('id, exercise_id, date, weight_kg, sets, reps')
    .order('date')
    .limit(10000);
  if (error) throw error;
  return data.map((log) => ({ ...log, weight_kg: Number(log.weight_kg), sets: Number(log.sets), reps: Number(log.reps) }));
}

// Volume de um registro: carga × séries × repetições. Peso do corpo (0 kg) não soma volume.
function logVolume(log) {
  return log.weight_kg * log.sets * log.reps;
}

// 1RM estimado pela fórmula de Epley. Perde precisão acima de ~12 repetições, por isso a
// interface sempre o chama de "estimado".
function estimateOneRepMax(log) {
  if (!log.weight_kg) return 0;
  return log.reps === 1 ? log.weight_kg : log.weight_kg * (1 + log.reps / 30);
}

// Ids dos registros que bateram o recorde de carga do exercício no dia em que foram feitos.
// O primeiro registro de um exercício não conta: ainda não havia o que superar.
function personalRecordIds(logsAsc) {
  const melhor = new Map();
  const recordes = new Set();
  logsAsc.forEach((log) => {
    const chave = String(log.exercise_id);
    if (melhor.has(chave) && log.weight_kg > melhor.get(chave)) recordes.add(log.id);
    if (!melhor.has(chave) || log.weight_kg > melhor.get(chave)) melhor.set(chave, log.weight_kg);
  });
  return recordes;
}

// Registrar de novo no mesmo dia substitui o valor anterior (índice único por exercício e data).
async function saveExerciseLog(exerciseId, dateKey, values) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data, error } = await supabaseClient
    .from('exercise_logs')
    .upsert({ user_id: user.id, exercise_id: exerciseId, date: dateKey, weight_kg: values.weight_kg, sets: values.sets, reps: values.reps }, { onConflict: 'user_id,exercise_id,date' })
    .select('id, exercise_id, date, weight_kg, sets, reps')
    .single();
  if (error) throw error;
  return data;
}

async function deleteExerciseLog(logId) {
  const { error } = await supabaseClient.from('exercise_logs').delete().eq('id', logId);
  if (error) throw error;
}
