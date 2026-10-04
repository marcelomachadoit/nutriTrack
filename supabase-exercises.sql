-- FitTrack — base compartilhada de exercícios.
-- Reúne os exercícios da planilha de treino (divisão de 5 dias) e outros exercícios populares
-- de academia. Cada um tem o nome nas três línguas e o grupo muscular que ele trabalha
-- principalmente.
--
-- Como aplicar: Supabase > SQL Editor > cole este arquivo > Run.
-- Rode depois de supabase.sql. O script é idempotente: rodar de novo atualiza os itens pelo
-- slug, sem apagar nada e preservando os ids usados por exercise_logs.
--
-- O slug é a identidade estável do exercício: os modelos de ficha (js/fit.js) apontam para
-- ele. Trocar o nome de um exercício aqui não quebra nada; trocar o slug, sim.

insert into public.exercises (slug, name, name_en, name_es, muscle_group) values
  -- Peito
  ('supino-reto-barra', 'Supino reto com barra', 'Barbell bench press', 'Press de banca con barra', 'chest'),
  ('supino-reto-halteres', 'Supino reto com halteres', 'Dumbbell bench press', 'Press de banca con mancuernas', 'chest'),
  ('supino-reto-maquina', 'Supino reto na máquina', 'Machine chest press', 'Press de pecho en máquina', 'chest'),
  ('supino-inclinado-barra', 'Supino inclinado com barra', 'Incline barbell bench press', 'Press inclinado con barra', 'chest'),
  ('supino-inclinado-halteres', 'Supino inclinado com halteres', 'Incline dumbbell press', 'Press inclinado con mancuernas', 'chest'),
  ('supino-declinado', 'Supino declinado', 'Decline bench press', 'Press declinado', 'chest'),
  ('crossover-polia', 'Crossover na polia', 'Cable crossover', 'Cruce de poleas', 'chest'),
  ('peck-deck', 'Peck deck (crucifixo máquina)', 'Pec deck (machine fly)', 'Pec deck (aperturas en máquina)', 'chest'),
  ('crucifixo-halteres', 'Crucifixo com halteres', 'Dumbbell fly', 'Aperturas con mancuernas', 'chest'),
  ('flexao-braco', 'Flexão de braço', 'Push-up', 'Flexiones de brazos', 'chest'),
  ('mergulho-paralelas', 'Mergulho nas paralelas', 'Parallel bar dips', 'Fondos en paralelas', 'chest'),

  -- Costas
  ('barra-fixa-pronada', 'Barra fixa pronada', 'Pull-up', 'Dominadas en pronación', 'back'),
  ('barra-fixa-supinada', 'Barra fixa supinada', 'Chin-up', 'Dominadas en supinación', 'back'),
  ('puxada-alta-aberta', 'Puxada alta pegada aberta', 'Wide-grip lat pulldown', 'Jalón al pecho agarre abierto', 'back'),
  ('puxada-alta-neutra', 'Puxada alta pegada neutra', 'Neutral-grip lat pulldown', 'Jalón al pecho agarre neutro', 'back'),
  ('remada-curvada-barra', 'Remada curvada com barra', 'Barbell bent-over row', 'Remo inclinado con barra', 'back'),
  ('remada-cavalinho', 'Remada cavalinho (T-bar)', 'T-bar row', 'Remo en barra T', 'back'),
  ('remada-apoiada-peito', 'Remada apoiada no peito (máquina)', 'Chest-supported row (machine)', 'Remo con apoyo en el pecho (máquina)', 'back'),
  ('remada-baixa-triangulo', 'Remada baixa com triângulo', 'Seated cable row', 'Remo bajo con triángulo', 'back'),
  ('remada-baixa-unilateral', 'Remada baixa unilateral na polia', 'Single-arm seated cable row', 'Remo bajo unilateral en polea', 'back'),
  ('remada-unilateral-halter', 'Remada unilateral com halter (serrote)', 'Single-arm dumbbell row', 'Remo unilateral con mancuerna', 'back'),
  ('pullover-polia', 'Pullover na polia', 'Cable pullover', 'Pullover en polea', 'back'),
  ('levantamento-terra', 'Levantamento terra', 'Deadlift', 'Peso muerto', 'back'),
  ('hiperextensao-lombar', 'Hiperextensão lombar', 'Back extension', 'Hiperextensión lumbar', 'back'),

  -- Ombros
  ('desenvolvimento-halteres', 'Desenvolvimento com halteres', 'Dumbbell shoulder press', 'Press de hombros con mancuernas', 'shoulders'),
  ('desenvolvimento-maquina', 'Desenvolvimento na máquina', 'Machine shoulder press', 'Press de hombros en máquina', 'shoulders'),
  ('desenvolvimento-militar', 'Desenvolvimento militar com barra', 'Barbell overhead press', 'Press militar con barra', 'shoulders'),
  ('elevacao-lateral-halteres', 'Elevação lateral com halteres', 'Dumbbell lateral raise', 'Elevaciones laterales con mancuernas', 'shoulders'),
  ('elevacao-lateral-polia', 'Elevação lateral na polia', 'Cable lateral raise', 'Elevación lateral en polea', 'shoulders'),
  ('elevacao-frontal', 'Elevação frontal', 'Front raise', 'Elevación frontal', 'shoulders'),
  ('crucifixo-reverso-maquina', 'Crucifixo reverso na máquina', 'Reverse pec deck', 'Aperturas inversas en máquina', 'shoulders'),
  ('crucifixo-reverso-polia', 'Crucifixo reverso na polia', 'Cable reverse fly', 'Aperturas inversas en polea', 'shoulders'),
  ('face-pull', 'Face pull', 'Face pull', 'Face pull', 'shoulders'),

  -- Trapézio
  ('encolhimento-halteres', 'Encolhimento com halteres', 'Dumbbell shrug', 'Encogimientos con mancuernas', 'traps'),
  ('remada-alta', 'Remada alta', 'Upright row', 'Remo al mentón', 'traps'),

  -- Bíceps
  ('rosca-direta-barra', 'Rosca direta com barra', 'Barbell curl', 'Curl con barra', 'biceps'),
  ('rosca-alternada', 'Rosca alternada com halteres', 'Alternating dumbbell curl', 'Curl alterno con mancuernas', 'biceps'),
  ('rosca-inclinada-halteres', 'Rosca inclinada com halteres', 'Incline dumbbell curl', 'Curl inclinado con mancuernas', 'biceps'),
  ('rosca-martelo', 'Rosca martelo', 'Hammer curl', 'Curl martillo', 'biceps'),
  ('rosca-scott-maquina', 'Rosca Scott na máquina', 'Machine preacher curl', 'Curl predicador en máquina', 'biceps'),
  ('rosca-bayesian', 'Rosca na polia (bayesian)', 'Bayesian cable curl', 'Curl bayesiano en polea', 'biceps'),
  ('rosca-concentrada', 'Rosca concentrada', 'Concentration curl', 'Curl concentrado', 'biceps'),

  -- Tríceps
  ('triceps-frances-polia', 'Tríceps francês na polia (acima da cabeça)', 'Overhead cable triceps extension', 'Extensión de tríceps sobre la cabeza en polea', 'triceps'),
  ('triceps-polia-barra', 'Tríceps na polia com barra', 'Triceps pushdown (bar)', 'Extensión de tríceps en polea con barra', 'triceps'),
  ('triceps-polia-corda', 'Tríceps na polia com corda', 'Rope triceps pushdown', 'Extensión de tríceps en polea con cuerda', 'triceps'),
  ('triceps-testa', 'Tríceps testa com barra W', 'EZ-bar skull crusher', 'Press francés con barra Z', 'triceps'),
  ('triceps-coice', 'Tríceps coice com halter', 'Dumbbell triceps kickback', 'Patada de tríceps con mancuerna', 'triceps'),
  ('triceps-banco', 'Mergulho no banco', 'Bench dip', 'Fondos en banco', 'triceps'),

  -- Antebraço
  ('rosca-punho', 'Rosca de punho (flexão)', 'Wrist curl', 'Curl de muñeca', 'forearms'),
  ('rosca-punho-inversa', 'Rosca de punho inversa (extensão)', 'Reverse wrist curl', 'Curl de muñeca inverso', 'forearms'),

  -- Abdômen
  ('abdominal-polia', 'Abdominal na polia (crunch com corda)', 'Cable crunch', 'Crunch en polea', 'abs'),
  ('elevacao-pernas-suspenso', 'Elevação de pernas suspenso', 'Hanging leg raise', 'Elevación de piernas colgado', 'abs'),
  ('roda-abdominal', 'Roda abdominal', 'Ab wheel rollout', 'Rueda abdominal', 'abs'),
  ('prancha', 'Prancha', 'Plank', 'Plancha', 'abs'),
  ('abdominal-supra', 'Abdominal supra', 'Crunch', 'Crunch abdominal', 'abs'),
  ('abdominal-obliquo', 'Abdominal oblíquo (russian twist)', 'Russian twist', 'Giro ruso', 'abs'),

  -- Quadríceps
  ('agachamento-livre', 'Agachamento livre com barra', 'Barbell back squat', 'Sentadilla con barra', 'quads'),
  ('agachamento-hack', 'Agachamento hack', 'Hack squat', 'Sentadilla hack', 'quads'),
  ('agachamento-goblet', 'Agachamento goblet', 'Goblet squat', 'Sentadilla goblet', 'quads'),
  ('leg-press', 'Leg press', 'Leg press', 'Prensa de piernas', 'quads'),
  ('afundo-bulgaro', 'Afundo búlgaro', 'Bulgarian split squat', 'Sentadilla búlgara', 'quads'),
  ('passada', 'Passada (avanço)', 'Walking lunge', 'Zancadas', 'quads'),
  ('cadeira-extensora', 'Cadeira extensora', 'Leg extension', 'Extensión de cuádriceps', 'quads'),

  -- Posterior de coxa
  ('stiff', 'Stiff (levantamento terra romeno)', 'Romanian deadlift', 'Peso muerto rumano', 'hamstrings'),
  ('mesa-flexora', 'Mesa flexora', 'Lying leg curl', 'Curl femoral tumbado', 'hamstrings'),
  ('cadeira-flexora', 'Cadeira flexora (sentado)', 'Seated leg curl', 'Curl femoral sentado', 'hamstrings'),
  ('bom-dia', 'Bom dia (good morning)', 'Good morning', 'Buenos días (good morning)', 'hamstrings'),

  -- Glúteos
  ('elevacao-pelvica', 'Elevação pélvica (hip thrust)', 'Hip thrust', 'Empuje de cadera (hip thrust)', 'glutes'),
  ('gluteo-polia', 'Glúteo na polia (coice)', 'Cable glute kickback', 'Patada de glúteo en polea', 'glutes'),
  ('cadeira-abdutora', 'Cadeira abdutora', 'Hip abduction machine', 'Máquina de abducción', 'glutes'),

  -- Panturrilha
  ('panturrilha-em-pe', 'Panturrilha em pé', 'Standing calf raise', 'Elevación de talones de pie', 'calves'),
  ('panturrilha-sentado', 'Panturrilha sentado', 'Seated calf raise', 'Elevación de talones sentado', 'calves'),
  ('panturrilha-leg-press', 'Panturrilha no leg press', 'Leg press calf raise', 'Elevación de talones en prensa', 'calves'),

  -- Corpo inteiro
  ('burpee', 'Burpee', 'Burpee', 'Burpee', 'full_body'),
  ('kettlebell-swing', 'Kettlebell swing', 'Kettlebell swing', 'Swing con kettlebell', 'full_body')
on conflict (slug) where user_id is null do update set
	name = excluded.name,
	name_en = excluded.name_en,
	name_es = excluded.name_es,
	muscle_group = excluded.muscle_group;

-- Conferência rápida:
--   select count(*) from public.exercises where user_id is null;   -- 75 itens desta carga
--   select muscle_group, count(*) from public.exercises where user_id is null group by 1 order by 1;
