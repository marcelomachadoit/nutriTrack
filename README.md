# NutriTrack

PWA mobile-first para contagem de calorias e acompanhamento nutricional. Usa HTML, CSS e JavaScript puro e foi preparado para hospedagem estática no Cloudflare Pages.

## Rodar localmente

Abra a pasta no VS Code e use a extensão Live Server ou outro servidor HTTP local. O Service Worker não funciona corretamente com `file://`.

## Supabase

O aplicativo agora exige uma sessão do Supabase antes de revelar o dashboard. Configure a URL e a chave `anon public` em `js/supabase.js` (ou defina `window.NUTRITRACK_SUPABASE_URL` e `window.NUTRITRACK_SUPABASE_ANON_KEY` antes desse script). A `service_role key` nunca deve ser usada no frontend.

Em um site estático do Cloudflare Pages, variáveis `.env` não são injetadas automaticamente no JavaScript do navegador. A URL e a anon key são credenciais públicas destinadas ao frontend; a proteção dos dados vem do Auth e das políticas RLS do banco. Nunca publique a service role key.

No Supabase, em **Authentication > URL Configuration**, defina **Site URL** como a URL do Cloudflare Pages e adicione essa mesma URL em **Redirect URLs**. Execute todo o arquivo `supabase.sql` no SQL Editor para ativar RLS e criar o perfil automaticamente no cadastro.

Em **Authentication > Password Security**, defina o tamanho mínimo da senha como `8` e mantenha a proteção contra senhas vazadas habilitada. O frontend também exige uma letra maiúscula, uma minúscula, um número e um caractere especial antes de chamar o cadastro.

### Links de e-mail (confirmação de cadastro e redefinição de senha)

Se o link do e-mail abre uma página com **"error: requested path is invalid"**, a URL de retorno não está liberada no projeto. Em **Authentication > URL Configuration**:

1. **Site URL**: a URL de produção do Cloudflare Pages, com `https://` e sem barra no fim.
2. **Redirect URLs**: adicione uma entrada por ambiente, com curinga para cobrir subcaminhos:
   - `https://seu-site.pages.dev/**`
   - `http://127.0.0.1:5500/**` (ou a porta que o Live Server usar)
   - `http://localhost:5500/**`

O app envia como retorno `window.location.origin + window.location.pathname`, ou seja, a própria página de onde o pedido saiu — por isso o endereço local precisa estar na lista para testar fora de produção. O Supabase valida essa URL **antes** de redirecionar, então enquanto ela não estiver liberada o erro aparece na página dele e o aplicativo nem chega a ser carregado.

O login bloqueia novas tentativas por 15 minutos depois de 5 falhas no mesmo navegador para o mesmo e-mail. Essa é uma camada adicional: a proteção principal contra força bruta deve continuar sendo o rate limit do Supabase Auth. O link **Esqueci minha senha** usa `resetPasswordForEmail`; configure a URL do Cloudflare Pages em **Authentication > URL Configuration > Redirect URLs** para que o link de recuperação retorne ao app.

## Idiomas

O app está em português, inglês e espanhol. O botão com o globo na barra superior abre a lista de idiomas, e a tela de login tem um seletor próprio (PT / EN / ES), já que ali ainda não existe barra. Sem escolha anterior, o app segue o idioma do aparelho; se não for um dos três, abre em português.

A escolha fica salva no aparelho (`localStorage`) e, com a conta aberta, também em `profiles.language`. A preferência da conta vale mais que a do aparelho, então quem escolheu inglês no celular vê inglês ao entrar pelo computador.

Tudo fica em `js/i18n.js`. A chave de cada texto é o próprio texto em português, e o código chama `t('Registrar em {0}', data)`. Se faltar alguma tradução, a interface mostra o português em vez de um identificador quebrado. Os textos fixos do HTML são guardados em português quando a página abre e traduzidos a partir desse original, então trocar de idioma várias vezes não acumula erro. Datas e números usam o formato de cada idioma (`2,400.5` e "Sep 21" em inglês; `2400,5` e "21 sept" em espanhol).

**Nomes dos alimentos:** a base compartilhada tem nome em inglês e espanhol (`name_en`, `name_es`), vindos de `data/nomes-alimentos.txt` e carregados pelo `supabase-foods.sql`. Só o nome muda: calorias e macros são os mesmos nas três línguas. A busca encontra o alimento por qualquer um dos nomes, então quem usa inglês acha "Alface" digitando "lettuce" ou "alface". As listas ficam em ordem alfabética do nome exibido.

**O que não é traduzido:** as porções ("1 xícara (150 g)") e os nomes de refeições, receitas e alimentos criados pelo usuário, que aparecem como ele escreveu. As refeições padrão de uma conta nova nascem no idioma em uso na hora do cadastro e depois viram dados do usuário.

Para acrescentar uma tradução, inclua a linha `[português, inglês, espanhol]` na lista `TRANSLATIONS` de `js/i18n.js`, mantendo os mesmos marcadores `{0}`, `{1}` nas três línguas.

## Metas nutricionais

No primeiro acesso, o app abre um questionário de 6 etapas (peso, altura, idade, sexo, nível de atividade e objetivo) e não deixa prosseguir até ser concluído. Quem já tem perfil completo entra direto. Na aba **Perfil**, "Recalcular metas" reabre o mesmo questionário já preenchido; ao salvar, o resumo do dia passa a usar as metas novas na hora, sem novo login.

O cálculo está em `js/goals.js`, separado em funções (`calculateBMR`, `calculateTDEE`, `calculateTargetCalories`, `calculateMacros`, orquestradas por `calculateNutritionGoals`):

- **BMR** pela fórmula de Mifflin-St Jeor.
- **TDEE** = BMR × fator de atividade (1,2 a 1,9).
- **Meta calórica** = TDEE × fator do objetivo (déficit de 10% ou 20%, manutenção, superávit de 5% ou 10%), com piso de 1200 kcal.
- **Macros**: proteína por kg (1,8 a 2,2 conforme o objetivo), gordura a 0,9 g/kg, e o carboidrato fica com as calorias restantes. Se proteína e gordura sozinhas passarem da meta, as duas caem proporcionalmente para sobrar ao menos 5% de carboidrato.

Todos esses números são constantes no topo de `js/goals.js` — para mudar a metodologia, altere lá e nada mais. São estimativas, e a interface diz isso: "gasto calórico estimado" e "meta diária estimada" aparecem separados para não serem confundidos.

Dois avisos acompanham o resultado. Um é permanente, no resumo do questionário e no card do Perfil: lembra que os valores são estimativas, lista as situações em que não devem ser seguidos (gravidez, amamentação, doença, transtorno alimentar, uso de medicamentos, extremos de peso e idade) e recomenda avaliação de nutricionista ou médico. O outro é condicional, disparado por `describeGoalWarnings()` quando o cálculo aciona um limite de segurança:

- **piso de 1200 kcal** — o gasto estimado é tão baixo que a meta de déficit ficaria abaixo do piso, e a meta acaba maior que o próprio gasto;
- **macros reduzidos** — proteína e gordura precisaram ser escaladas para caber na meta, sinal de uma combinação exigente de peso e déficit.

Os sinalizadores (`floor_applied`, `macros_adjusted`) não são colunas do banco: o card do Perfil os recalcula a partir das respostas salvas.

Os dados ficam em `public.profiles`, que já guardava idade, peso, altura e objetivo — não há tabela separada. As colunas `bmr`, `tdee`, `target_calories`, `protein_g`, `carbs_g` e `fat_g` são gravadas junto para o dashboard ler sem recalcular. Não há histórico: cada recálculo substitui o anterior.

Os testes de cálculo rodam sem dependência nenhuma:

```
node test-goals.js
```

## Refeições do dia

As refeições não são mais quatro tipos fixos no código: cada conta tem as suas, em `public.meal_slots`. O botão **Personalizar refeições**, ao lado do título "Refeições", abre a lista para renomear, acrescentar ("Ceia", "Lanche 2", "Pré-treino"), trocar o ícone e remover. Uma conta nova começa com café da manhã, almoço, lanche e jantar, que servem só de ponto de partida.

O botão **+** da barra inferior registra consumo: escolha a refeição, busque o alimento, informe quantidade e medida — e o card da refeição passa a listar o item com suas calorias. O mesmo diálogo tem a aba **Receita**, que lança todos os ingredientes de uma receita salva de uma vez, cada um como um registro separado para continuar editável.

Remover uma refeição apaga os registros feitos nela (`on delete cascade` em `meals.slot_id`), e o app avisa disso antes de confirmar. A coluna antiga `meals.meal_type` virou opcional e deixou de ser usada; ficou no schema para não descartar registros anteriores.

## Calendário e progresso

Na aba **Início**, as setas ao lado da data passam para o dia anterior ou seguinte, e o botão da data abre um calendário mensal: dias com alimentos registrados têm um ponto, e dias futuros ficam bloqueados. Todo o resumo, as refeições e o registro pelo **+** passam a valer para o dia escolhido, o que permite lançar algo esquecido de ontem. "Voltar para hoje" aparece sempre que o dia exibido não é o atual.

As datas são sempre as do fuso do aparelho (`toDateKey()` em `js/meals.js`). Antes o app usava a data em UTC, e no Brasil registros feitos depois das 21h caíam no dia seguinte.

Na aba **Progresso**, o gráfico mostra a semana de segunda a domingo: uma barra por dia com a altura das calorias consumidas, dividida pela contribuição de proteína, carboidratos e gorduras, com a meta diária como linha tracejada. Dias sem registro ficam em zero. As setas navegam para semanas anteriores; tocar ou passar o mouse numa barra mostra os valores do dia, com um atalho para abrir esse dia no Início, e "Ver em tabela" traz os mesmos números em formato de tabela. O gráfico é recalculado a cada registro, remoção ou troca de dia.

Abaixo, o **acompanhamento de peso** substituiu o card de meta que tinha números fixos no código. Cada pesagem fica em `public.weight_logs`, uma por dia (registrar de novo no mesmo dia substitui o valor), privada de cada conta. O card mostra o peso atual, a variação no período e um gráfico de linha de 30 dias, 90 dias ou todo o histórico, com o ponto de cada pesagem e detalhe ao passar o mouse ou tocar. Um peso-meta opcional (`profiles.target_weight`) aparece como linha tracejada e alimenta a barra de progresso, que conta a partir da primeira pesagem e funciona tanto para perder quanto para ganhar peso. Concluir o questionário de metas já registra o peso informado. Quando o peso atual se afasta 2 kg ou mais do peso usado no cálculo das metas, o card sugere recalculá-las.

As cores do gráfico são tokens próprios (`--chart-protein`, `--chart-carbs`, `--chart-fats`), validados para daltonismo e luminosidade contra a superfície de cada tema.

## Alimentos e receitas do usuário

Além da base compartilhada, cada conta pode criar os próprios alimentos e receitas pela aba **Alimentos**:

- **Adicionar alimento** grava nome, unidade (`g`, `ml` ou `un`), a quantidade base de referência e os valores correspondentes a ela — calorias, proteína, carboidratos e gordura. A base é livre: dá para cadastrar "por 30 g", "por 250 ml" ou "por 1 unidade", não só por 100. O alimento recebe `user_id` e aparece na lista com o selo "Meu", com botões de editar e excluir.
- **Adicionar receita** monta uma combinação fixa de alimentos com quantidade (ex.: "Almoço 1" = 100 g de arroz + 100 g de feijão + 150 g de carne), somando calorias e macros automaticamente. Serve para quem repete as mesmas refeições.

O seletor de alimento tem uma busca por texto que filtra o catálogo carregado em memória, sem ir ao servidor. Ela ignora acentos e maiúsculas — "acucar" encontra "Açúcar", "pao" encontra os quatro pães — e mostra a contagem de resultados ao lado do rótulo.

Ao incluir um ingrediente dá para escolher a medida: a unidade base do alimento (`g`, `ml` ou `un`) ou a porção prática, quando o alimento tem `portion_amount` — "1 unidade média (90 g)", "1 copo (200 ml)". O app converte para a unidade base antes de salvar, então `recipe_items.quantity` está sempre na mesma escala dos valores nutricionais. Medidas sem conversão conhecida não são oferecidas: transformar g em ml exigiria a densidade do alimento, e o resultado seria um número inventado. Para liberar a medida por unidade em um alimento seu, preencha "Peso de 1 unidade" no cadastro dele.

Ambos são privados: a RLS entrega a um usuário apenas a base compartilhada (`foods.user_id is null`) e as próprias linhas. Um usuário não consegue ler, editar nem apagar o conteúdo de outro, e também não consegue alterar a base compartilhada — ela só muda pelo SQL Editor.

Excluir um alimento o remove das receitas em que aparece (`on delete cascade`). Se ele já estiver em uma refeição registrada, o banco recusa a exclusão e o app avisa, para não apagar histórico.

## Base de alimentos

A tabela `public.foods` é compartilhada por todos os usuários: qualquer conta autenticada lê, e ninguém escreve pelo aplicativo (a RLS só tem policy de `select`). A carga é feita pelo SQL Editor do Supabase.

Depois de rodar `supabase.sql`, execute `supabase-foods.sql` para inserir os 166 itens da base nutricional (150 alimentos, 15 bebidas alcoólicas e 1 energético). O script é idempotente: ele faz `upsert` pelo nome, então rodar de novo atualiza os valores sem duplicar registros e sem alterar os `id` já referenciados em `public.meals`.

Os valores vêm de `data/tabela-nutricional.txt`, que é a fonte da verdade — para corrigir um alimento, edite o `.txt` e gere o SQL de novo. Cada item guarda:

- `calories`, `protein`, `carbohydrates` e `fat` correspondentes a `serving_size` na unidade de `base_unit` (`g`, `ml` ou `un`). Na base compartilhada `serving_size` é sempre 100; nos alimentos do usuário é livre;
- `portion_label` e `portion_amount` com a porção comum aproximada (ex.: `1 xícara (150 g)` / `150`), nula nas bebidas alcoólicas;
- quantidades intermediárias são calculadas por regra de três em `calculateNutrition()`.

## FitTrack (treinos)

O mesmo app tem uma segunda seção, o **FitTrack**, para acompanhar a academia. O nome na barra superior ("NutriTrack") é um botão: ele abre um menu com NutriTrack e FitTrack. A escolha fica salva no aparelho (`nutritrack-app-mode`), então o app reabre na última seção usada. Conta, tema, idioma e Perfil são os mesmos nas duas.

O FitTrack tem três abas:

- **Treino** (início): mostra o treino do dia (A, B, C...) e, para cada exercício, o que foi feito no treino anterior (carga, séries e repetições) com o botão **Novos dados** ao lado, para registrar o valor de hoje. Depois de registrado, o botão passa a mostrar o valor do dia e a diferença de carga em relação ao anterior. Registrar de novo no mesmo dia substitui o valor.
- **Estatísticas**: com filtro de período (4 semanas, 12 semanas ou tudo) no topo e um resumo do período (treinos, séries, carga total e recordes batidos). Abaixo:
  - **Evolução por exercício** — gráfico de linha de um exercício escolhido, em carga, 1RM estimado (fórmula de Epley) ou volume (carga × séries × repetições). Exercício feito só com o peso do corpo mostra repetições. Pontos com anel são recordes de carga.
  - **Volume semanal** — barras por semana (segunda a domingo) em séries ou carga total, e a lista de séries por grupo muscular no período.
  - **Recordes pessoais** — a maior carga de cada exercício em todo o histórico, com o 1RM estimado daquele dia; recorde batido nos últimos 7 dias ganha o selo "Novo".
  - **Treinos recentes** — os últimos 8 dias com treino, com exercícios, séries e carga total.

  Os gráficos mostram valores ao passar o mouse ou tocar, e cada um tem uma tabela com os mesmos números ("Ver em tabela"). Tudo é calculado no aparelho a partir de `exercise_logs` (`js/fit-stats.js`); não há tabela de agregados. Ao registrar uma carga maior que todas as anteriores do exercício, a aba Treino avisa o novo recorde.
- **Exercícios**: banco de exercícios com busca, filtro por grupo muscular e cadastro de exercícios próprios (nome + grupo muscular principal), visíveis só na conta de quem criou.

**Ficha, ciclo e descansos.** Cada conta tem uma ficha (`public.workout_plans`): a sequência de dias do ciclo, com até 7 treinos (A a G, na ordem em que aparecem) e dias de **descanso**, num total de até 14 posições. Uma conta nova começa com **A → B → C → descanso** (os três primeiros dias da planilha). Em **Editar ficha** dá para acrescentar ou remover treinos e descansos, mudar a ordem com as setas, renomear, incluir/remover exercícios numa lista com busca agrupada por músculo, ajustar séries e repetições e arrastar os exercícios para reordenar. As abas quebram linha, então todas ficam à vista mesmo com muitos treinos. Os modelos prontos já trazem descansos: AB (A, B, descanso), ABC (A, B, C, descanso), ABCD (A, B, descanso, C, D, descanso) e ABCDE (a planilha de 5 dias: cinco treinos e dois descansos). Nada é gravado até tocar em **Salvar ficha**.

Cada dia do calendário avança uma posição do ciclo e volta ao começo depois da última (`workoutIndexFor()` em `js/fit.js`, a partir de `anchor_date` / `anchor_index`). A tela de treino mostra os **próximos 7 dias** com o treino ou o descanso de cada um. Em dia de descanso o card principal fica violeta, sem contadores, e mostra o próximo treino, com a opção "Treinar mesmo assim". Para trocar o dia de hoje, toque em outro treino (ou num descanso) e em **Fazer o X hoje** / **Descansar hoje**: o ciclo passa a continuar a partir dali. Reordenar a ficha não muda o que cai hoje.

**Banco de dados.** Rode `supabase.sql` (que cria `exercises`, `workout_plans` e `exercise_logs`, com RLS — rode de novo se já tinha rodado antes dos dias de descanso, para atualizar o limite da ficha) e depois `supabase-exercises.sql`, que carrega 75 exercícios — os da planilha e outros populares — com nome em português, inglês e espanhol e o grupo muscular principal. A carga é idempotente e usa o `slug` de cada exercício como identidade; os modelos de ficha apontam para esses slugs. Os registros (`exercise_logs`) apontam para o exercício e não para a ficha, então mudar a ficha não apaga histórico; excluir um exercício próprio apaga os registros dele.

Os nomes dos treinos da ficha são dados do usuário: nascem no idioma em uso quando a ficha é criada e não mudam ao trocar de idioma, como os nomes das refeições.

## Cloudflare Pages

Envie o projeto para GitHub, conecte o repositório no Cloudflare Pages, deixe o comando de build vazio e use a raiz como diretório de saída.

## iPhone

Abra a URL publicada no Safari, toque em Compartilhar e escolha **Adicionar à Tela de Início**. O manifest, o apple-touch-icon e as meta tags já estão configurados para o NutriTrack.

## Estado atual

- Tela de login/cadastro obrigatória antes do dashboard.
- Supabase Auth, busca de alimentos e leitura/exclusão de refeições preparados.
- Base nutricional com 166 itens em `supabase-foods.sql`, com macros por 100 g/ml e porção comum.
- Dashboard mobile-first com totais nutricionais calculados a partir das refeições.
- RLS definido em `supabase.sql` para que cada usuário veja apenas seus próprios registros.
- Interface com design system em `css/style.css` (tokens de cor, raio, sombra e movimento), ícones SVG inline e tema claro/escuro. O tema segue a preferência do sistema e pode ser alternado no botão da barra superior; a escolha fica salva em `localStorage`.

## Próxima etapa

Adicionar o formulário de seleção de alimento, quantidade e tipo de refeição para completar o fluxo de criação de registros.
